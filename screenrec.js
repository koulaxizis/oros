// ============================================================
// orOS — screenrec.js (Screen recording from Quick settings,
// QS-REC-1, v1.0.0)
// ------------------------------------------------------------
// A shell component, loaded on demand (like emoji.js): it runs IN the
// shell document, so a recording goes on while apps open and close
// (without multitasking the app frame is replaced; a recorder inside
// Screen Capture's frame would end with it).
//
// Flow: Quick settings' "Screen recording" tap → shell.js recTake()
// asks for the screen at once (the tap is the gesture the browser's
// picker needs) → loads capture/core.js (Screen Capture's pure
// helpers: format, quality, file names) and this file → start():
//   • records with MediaRecorder: MP4 where the browser writes it, else
//     WebM; Screen Capture's options ("oros-capture-prefs": quality,
//     frame rate; the sound of the screen as ticked in the browser's
//     picker; the microphone only when it is on there, off by default);
//   • the smart bar shows the time with a stop button
//     (orosSmartBar.live("rec", …)), Quick settings shows the time and
//     a tap stops it; stopping the share in the browser stops it too;
//   • stops by itself at 1 GB (held in memory until saved);
//   • on stop the clip is saved in Files › Videos (/internal/Videos/,
//     "Screen recording <date>.mp4", never over another file) and a
//     toast says so (a tap opens it in Files). If the orOS disk
//     refuses it, the browser downloads it instead, so it is never lost.
// Nothing leaves the device; no network. One recording at a time
// (also none while Screen Capture records on its own).
// Pure parts (recSources, saveName) are tested in node
// (tests/screenrec.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

  // ---------- 1. Model (pure) ----------
  // Which sound goes in: the screen's (when the picker shared some) and
  // the microphone's (when asked for and allowed). "mix" = both, mixed
  // into one track in an AudioContext.
  function recSources(sysCount, micOn) {
    var n = (sysCount > 0 ? 1 : 0) + (micOn ? 1 : 0);
    return { sys: sysCount > 0, mic: !!micOn, mix: n === 2 };
  }
  // The n-th try of the file's path in Files › Videos.
  function saveName(C, label, at, type, n) {
    return C.pathFor(C.fileName(label, at, C.recExt(type)), n, C.VIDEOS);
  }

  var model = { VER: VER, recSources: recSources, saveName: saveName };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  // host (shell.js): { t(key), toast(kind, text, onClick), fs() → orosFS,
  //   bar(handle|null), calm(), openFile(path), busy() → bool }
  var host = null, cur = null;
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function t(k) { return host ? host.t(k) : k; }
  function core() { return root.CaptureCore || null; }
  function stopTracks(s) {
    if (s) call(function () { s.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} }); });
  }
  function ms(r) { return Date.now() - r.at.getTime(); }

  function micStream(on) {
    if (!on) return Promise.resolve(null);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(null, function () { host.toast("err", t("qs.rec.nomic")); return null; });
  }

  // start(stream, raw prefs): the shared stream from the picker. Every
  // failure stops the sharing and says so; nothing is kept.
  function start(stream, raw) {
    var C = core();
    if (!host || !C || !stream || cur || call(function () { return host.busy(); })) { stopTracks(stream); return false; }
    var p = C.prefs(raw);
    var video = stream.getVideoTracks()[0];
    if (!video) { stopTracks(stream); return false; }
    var type = C.recType(function (x) { return typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(x); });
    var pending = { src: stream };
    cur = pending;   // holds the place while the microphone is asked for
    call(function () { host.calm(); });
    micStream(p.mic).then(function (mic) {
      if (cur !== pending || video.readyState === "ended") { stopTracks(mic); if (cur === pending) cur = null; stopTracks(stream); return; }
      var sys = stream.getAudioTracks();
      var how = recSources(sys.length, !!mic), tracks = [video], ctx = null;
      if (how.mix) {
        var AC = root.AudioContext || root.webkitAudioContext;
        ctx = new AC();
        var dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(new MediaStream([sys[0]])).connect(dest);
        ctx.createMediaStreamSource(mic).connect(dest);
        tracks.push(dest.stream.getAudioTracks()[0]);
      } else if (how.sys) tracks.push(sys[0]);
      else if (how.mic) tracks.push(mic.getAudioTracks()[0]);
      var mo = { videoBitsPerSecond: C.videoBps(p), audioBitsPerSecond: C.AUDIO_BPS }, mr;
      if (type) mo.mimeType = type;
      try { mr = new MediaRecorder(new MediaStream(tracks), mo); }
      catch (e) {
        cur = null; stopTracks(mic); stopTracks(stream); if (ctx) call(function () { ctx.close(); });
        host.toast("err", t("qs.rec.fail"));
        return;
      }
      var r = { mr: mr, chunks: [], bytes: 0, type: mr.mimeType || type || "video/webm", at: new Date(),
                src: stream, mic: mic, ctx: ctx, done: false };
      r.handle = {
        state: function () { return cur === r ? { ms: ms(r), paused: false } : null; },
        stop: function () { if (cur === r) stop(); },
        // The smart bar's pill: a tap opens Files › Videos (Screen Capture has no part in it).
        go: function () { call(function () { host.openFile(C.VIDEOS); }); }
      };
      mr.ondataavailable = function (ev) {
        if (!ev.data || !ev.data.size) return;
        r.chunks.push(ev.data);
        r.bytes += ev.data.size;
        if (r.bytes >= C.MAX_BYTES && cur === r) { host.toast("err", t("qs.rec.limit")); stop(); }
      };
      mr.onstop = function () { finish(r); };
      video.addEventListener("ended", function () { if (cur === r) stop(); });   // "Stop sharing" in the browser
      cur = r;
      mr.start(1000);
      host.bar(r.handle);
    });
    return true;
  }

  function stop() {
    var r = cur;
    if (!r || !r.mr) return;
    cur = null;
    host.bar(null);
    try { if (r.mr.state !== "inactive") r.mr.stop(); else finish(r); }
    catch (e) { finish(r); }
  }

  function finish(r) {
    if (r.done) return;
    r.done = true;
    stopTracks(r.src);
    stopTracks(r.mic);
    if (r.ctx) call(function () { r.ctx.close(); });
    if (!r.bytes) { host.toast("err", t("qs.rec.fail")); return; }
    var blob = new Blob(r.chunks, { type: r.type.split(";")[0] });
    r.chunks = [];
    save(blob, r.at);
  }

  function save(blob, at) {
    var C = core(), F = call(function () { return host.fs(); });
    if (!F) { download(blob, C.fileName(t("qs.rec.file"), at, C.recExt(blob.type))); return; }
    var n = 1;
    (function tryName() {
      var path = saveName(C, t("qs.rec.file"), at, blob.type, n);
      F.stat(path).then(function () { n++; if (n < 100) tryName(); else saveFailed(blob, at); }, function () {
        F.write(path, blob).then(function () {
          host.toast("ok", t("qs.rec.saved").replace("{name}", path.slice(C.VIDEOS.length)),
            function () { host.openFile(path); });
        }, function () { saveFailed(blob, at); });
      });
    })();
  }
  // The orOS disk refused it (full?): the browser downloads it instead.
  function saveFailed(blob, at) {
    var C = core();
    download(blob, C.fileName(t("qs.rec.file"), at, C.recExt(blob.type)));
    host.toast("err", t("qs.rec.nosave"));
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  root.orosScreenRec = {
    VER: VER,
    attach: function (h) { host = h || null; },
    start: start,
    stop: stop,
    running: function () { return !!cur; }
  };
})(typeof window !== "undefined" ? window : this);
