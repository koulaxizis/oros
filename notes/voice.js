// ============================================================
// orOS Notes — voice notes (notes/voice.js, window.OrosNotesVoiceUI)
// NOTES-VOICE V1: record into a page, play, download, delete.
// V2: trim (a new file, the old one to the Trash), transcription on the
// device with Montage's Whisper (montage/asr.js, the shared model in
// IndexedDB oros-montage-ai), send to Studio (orosFileOpen.hand).
// Pure rules live in voice-core.js (window.OrosNotesVoice).
//   - The microphone goes through MediaRecorder (webm/Opus, Safari
//     mp4/AAC). No speech recognition API is ever used (rule 30).
//   - Every 5 s a piece of the recording goes to IndexedDB
//     "oros-notes-rec" (this device only), so a closed tab or a crash
//     loses at most a few seconds: the next start offers it back.
//   - Stop writes ONE file to /internal/Notes/Voice through the
//     shell's orosFS (Vault Drive syncs it per file) and puts one
//     voice line into the page where the recording started.
//   - Delete moves the file to Files' Trash exactly as Files does
//     (files-core.js: the record first, then the item), never rm.
// The host (notes.js) hands in: t, tf, toast, confirm, page(id),
// current(), pages(), setText(id, text, caret), caret(id),
// download(blob, name, mime).
// ============================================================
(function () {
  "use strict";

  var V = window.OrosNotesVoice;
  var FC = window.OrosFilesCore || null;
  var host = null;

  var ICON = {
    mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    cancel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'
  };

  function t(k) { return host.t(k); }
  function tf(k, p) { return host.tf(k, p); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function iconBtn(cls, icon, label) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = ICON[icon];            // fixed markup from this file only
    b.title = label;
    b.setAttribute("aria-label", label);
    return b;
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; } catch (e) { return null; }
  }
  function vaultApi() {
    try { return (window.parent && window.parent.orosVault) || window.orosVault || null; } catch (e) { return null; }
  }
  function canRecord() {
    return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      V.pickMime(MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : null));
  }
  function rand() { return Math.random().toString(36).slice(2, 6); }
  function mb(bytes) { return (Math.max(0.1, bytes / 1048576)).toFixed(1); }

  // A label for a recording from its name: "12 Nov, 18:10".
  function whenOf(name) {
    var at = V.timeOf(name);
    if (!at) return name;
    var d = new Date(at);
    try {
      return d.toLocaleDateString(host.locale || undefined, { day: "numeric", month: "short" }) + ", " +
        d.toLocaleTimeString(host.locale || undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
  }

  // ---------- IndexedDB pieces (crash recovery) ----------
  var DB_NAME = "oros-notes-rec";
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("no-idb")); return; }
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains("recs")) d.createObjectStore("recs", { keyPath: "rid" });
        if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks", { keyPath: ["rid", "seq"] });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error("idb")); };
    });
    dbP.catch(function () { dbP = null; });
    return dbP;
  }
  function tx(stores, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var x = d.transaction(stores, mode), out;
        x.oncomplete = function () { res(out); };
        x.onerror = x.onabort = function () { rej(x.error || new Error("idb")); };
        out = fn(x);
      });
    });
  }
  function idbPutRec(r) { return tx(["recs"], "readwrite", function (x) { x.objectStore("recs").put(r); }); }
  function idbPutChunk(rid, seq, blob) {
    return tx(["chunks"], "readwrite", function (x) { x.objectStore("chunks").put({ rid: rid, seq: seq, blob: blob }); });
  }
  function idbAll(store) {
    return tx([store], "readonly", function (x) {
      var box = { v: [] }, rq = x.objectStore(store).getAll();
      rq.onsuccess = function () { box.v = rq.result || []; };
      return box;
    }).then(function (box) { return box.v; });
  }
  function idbChunks(rid) {
    return tx(["chunks"], "readonly", function (x) {
      var box = { v: [] };
      var rq = x.objectStore("chunks").getAll(IDBKeyRange.bound([rid, 0], [rid, Infinity]));
      rq.onsuccess = function () { box.v = rq.result || []; };
      return box;
    }).then(function (box) {
      return box.v.sort(function (a, b) { return a.seq - b.seq; }).map(function (c) { return c.blob; });
    });
  }
  function idbDrop(rid) {
    return tx(["recs", "chunks"], "readwrite", function (x) {
      x.objectStore("recs").delete(rid);
      x.objectStore("chunks").delete(IDBKeyRange.bound([rid, 0], [rid, Infinity]));
    });
  }

  // notes.js loads this file at start when the flag is there, so a
  // cut-off recording is offered back (recover clears it when none is left).
  var LIVE_KEY = "oros-notes-rec-live";
  function liveFlag(on) {
    try { if (on) localStorage.setItem(LIVE_KEY, "1"); else localStorage.removeItem(LIVE_KEY); } catch (e) {}
  }

  // ---------- Writing a recording to the disk ----------
  // → Promise<name>. Never over an existing file (freeName + stat).
  function writeFile(blob, at, ext) {
    var fs = fsApi();
    if (!fs) return Promise.reject(new Error("no-disk"));
    return Promise.resolve(fs.ls(V.DIR)).catch(function () { return []; }).then(function (list) {
      var taken = (list || []).map(function (e) { return e.name; });
      var name = V.freeName(new Date(at), rand, ext, taken);
      if (!name) throw new Error("no-name");
      var path = V.pathOf(name);
      return Promise.resolve(fs.stat(path)).then(function () { throw new Error("taken"); }, function () {
        return fs.write(path, blob);
      }).then(function () { return name; });
    });
  }
  // Puts the line into the page the recording belongs to (or, when it
  // is gone, the open page). → the page id used, or null.
  function addLine(pageId, name, ms) {
    var p = host.page(pageId) || host.current();
    if (!p) return null;
    var pos = host.caret(p.id);
    var r = V.insertLine(p.text || "", pos, V.lineFor(name, ms));
    host.setText(p.id, r.text, r.caret);
    return p.id;
  }

  // ---------- Recording ----------
  var rec = null;          // the live recording, at most one per tab
  function elapsed(r) {
    var now = r.pauseAt || Date.now();
    return Math.max(0, now - r.started - r.paused);
  }

  function start() {
    if (rec) { showBar(); return; }
    var page = host.current();
    if (!page) return;
    if (!fsApi()) { host.toast(t("vc.noDisk")); return; }
    if (!canRecord()) { host.toast(t("vc.noRec")); return; }
    var fmt = V.pickMime(MediaRecorder.isTypeSupported.bind(MediaRecorder));
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        var mr;
        try { mr = new MediaRecorder(stream, { mimeType: fmt.mime, audioBitsPerSecond: V.BITS }); }
        catch (e) { mr = new MediaRecorder(stream); }
        var r = {
          rid: "r" + Date.now().toString(36) + rand(), pageId: page.id, stream: stream, mr: mr,
          started: Date.now(), paused: 0, pauseAt: 0, seq: 0, parts: [], ext: V.extForMime(mr.mimeType || fmt.mime),
          mime: mr.mimeType || fmt.mime, saving: false, cancelled: false, failedIdb: false
        };
        rec = r;
        liveFlag(true);
        idbPutRec({ rid: r.rid, page: r.pageId, mime: r.mime, ext: r.ext, at: r.started, ms: 0 }).catch(function () { r.failedIdb = true; });
        mr.ondataavailable = function (e) {
          if (!e.data || !e.data.size || r.cancelled) return;
          r.parts.push(e.data);
          var seq = r.seq++;
          idbPutChunk(r.rid, seq, e.data).then(function () {
            return idbPutRec({ rid: r.rid, page: r.pageId, mime: r.mime, ext: r.ext, at: r.started, ms: elapsed(r) });
          }).catch(function () { r.failedIdb = true; });
        };
        mr.onstop = function () { finish(r); };
        stream.getAudioTracks().forEach(function (tr) {
          tr.addEventListener("ended", function () { if (rec === r) stop(); });   // mic unplugged, OS took it
        });
        meter(r);
        mr.start(V.CHUNK_MS);
        showBar();
        r.tick = setInterval(function () { tick(r); }, 250);
      }, function (e) {
        host.toast(e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? t("vc.denied") : t("vc.noMic"));
      });
  }

  function meter(r) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      r.ac = new AC();
      var src = r.ac.createMediaStreamSource(r.stream);
      r.an = r.ac.createAnalyser();
      r.an.fftSize = 512;
      src.connect(r.an);
      r.buf = new Uint8Array(r.an.fftSize);
    } catch (e) { r.an = null; }
  }
  function level(r) {
    if (!r.an || r.pauseAt) return 0;
    r.an.getByteTimeDomainData(r.buf);
    var peak = 0;
    for (var i = 0; i < r.buf.length; i++) { var v = Math.abs(r.buf[i] - 128); if (v > peak) peak = v; }
    return Math.min(1, peak / 100);
  }
  function tick(r) {
    if (rec !== r) return;
    var ms = elapsed(r);
    if (ms >= V.MAX_MS) { host.toast(t("vc.maxed")); stop(); return; }
    var bar = document.getElementById("voice-bar");
    if (!bar) return;
    bar.querySelector(".vb-time").textContent = V.fmtDur(ms);
    bar.querySelector(".vb-lvl i").style.width = Math.round(level(r) * 100) + "%";
    var sz = bar.querySelector(".vb-size");
    sz.hidden = ms < V.BIG_MS;
    if (!sz.hidden) sz.textContent = tf("vc.size", { mb: mb(V.sizeAt(ms)) });
  }

  function pause() {
    if (!rec || rec.saving) return;
    var r = rec;
    if (r.pauseAt) {
      r.paused += Date.now() - r.pauseAt; r.pauseAt = 0;
      try { r.mr.resume(); } catch (e) {}
    } else {
      r.pauseAt = Date.now();
      try { r.mr.pause(); r.mr.requestData(); } catch (e) {}
    }
    showBar();
  }
  function stop() {
    if (!rec || rec.saving) return;
    var r = rec;
    if (r.pauseAt) { r.paused += Date.now() - r.pauseAt; r.pauseAt = 0; }
    r.ms = elapsed(r);
    r.saving = true;
    showBar();
    try { r.mr.stop(); } catch (e) { finish(r); }
  }
  function cancel() {
    if (!rec || rec.saving) return;
    var r = rec;
    var go = function () {
      r.cancelled = true;
      r.saving = true;
      try { r.mr.stop(); } catch (e) { finish(r); }
    };
    if (elapsed(r) < 10000) { go(); return; }
    host.confirm(t("vc.cancelT"), t("vc.cancelB"), t("vc.discard"), go);
  }
  function release(r) {
    clearInterval(r.tick);
    try { r.stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
    try { if (r.ac) r.ac.close(); } catch (e2) {}
  }
  function finish(r) {
    if (r.done) return;
    r.done = true;
    release(r);
    if (rec === r) rec = null;
    if (r.cancelled) { idbDrop(r.rid).then(recover, function () {}); hideBar(); return; }
    var ms = r.ms || elapsed(r);
    var blob = new Blob(r.parts, { type: r.mime.split(";")[0] || "audio/webm" });
    if (!blob.size) { hideBar(); idbDrop(r.rid).catch(function () {}); host.toast(t("vc.empty")); return; }
    save(r.rid, r.pageId, blob, r.started, r.ext, ms, r.failedIdb).then(hideBar, hideBar);
  }
  // Writes the file, then the line, then forgets the pieces.
  function save(rid, pageId, blob, at, ext, ms, noBackup) {
    return writeFile(blob, at, ext).then(function (name) {
      var used = addLine(pageId, name, ms);
      host.toast(used ? t("vc.saved") : t("vc.savedNoPage"));
      return idbDrop(rid).then(function () { if (!rec) recover(); }, function () {});
    }, function () {
      host.toast(noBackup ? t("vc.saveFailLost") : t("vc.saveFail"));
    });
  }

  // ---------- The recording bar ----------
  function showBar() {
    var r = rec;
    var bar = document.getElementById("voice-bar");
    if (!r) { hideBar(); return; }
    if (!bar) {
      bar = el("div", "voice-bar");
      bar.id = "voice-bar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", t("vc.bar"));
      var dot = el("span", "vb-dot"); dot.setAttribute("aria-hidden", "true");
      var st = el("span", "vb-state");
      st.setAttribute("aria-live", "polite");
      var time = el("span", "vb-time", "0:00");
      var lvl = el("span", "vb-lvl"); lvl.appendChild(el("i")); lvl.setAttribute("aria-hidden", "true");
      var size = el("span", "vb-size"); size.hidden = true;
      var where = el("span", "vb-where");
      var pb = iconBtn("icon-btn vb-pause", "pause", t("vc.pause"));
      pb.addEventListener("click", pause);
      var sb = iconBtn("icon-btn vb-stop", "stop", t("vc.stop"));
      sb.addEventListener("click", stop);
      var cb = iconBtn("icon-btn vb-cancel", "cancel", t("vc.cancel"));
      cb.addEventListener("click", cancel);
      [dot, st, time, lvl, size, where, pb, sb, cb].forEach(function (x) { bar.appendChild(x); });
      var tb = document.getElementById("md-toolbar");
      var pane = document.getElementById("editor-pane");
      if (tb && tb.parentNode) tb.parentNode.insertBefore(bar, tb.nextSibling);
      else if (pane) pane.appendChild(bar);
    }
    bar.classList.toggle("paused", !!r.pauseAt);
    bar.classList.toggle("saving", !!r.saving);
    bar.querySelector(".vb-state").textContent = r.saving ? t("vc.saving") : (r.pauseAt ? t("vc.paused") : t("vc.recording"));
    var pb2 = bar.querySelector(".vb-pause");
    pb2.innerHTML = ICON[r.pauseAt ? "mic" : "pause"];
    var lab = r.pauseAt ? t("vc.resume") : t("vc.pause");
    pb2.title = lab; pb2.setAttribute("aria-label", lab);
    pb2.hidden = typeof r.mr.pause !== "function";
    [pb2, bar.querySelector(".vb-stop"), bar.querySelector(".vb-cancel")].forEach(function (b) { b.disabled = !!r.saving; });
    var cur = host.current(), pg = host.page(r.pageId);
    var w = bar.querySelector(".vb-where");
    w.hidden = !pg || (cur && cur.id === r.pageId);
    if (!w.hidden) w.textContent = tf("vc.into", { title: pg.title || t("page.untitled") });
    tick(r);
    micState();
  }
  function hideBar() {
    var bar = document.getElementById("voice-bar");
    if (bar) bar.remove();
    micState();
  }

  // ---------- The mic button (editor header) ----------
  function micState() {
    var b = document.getElementById("btn-voice");
    if (!b) return;
    b.hidden = !host.current() && !rec;
    b.classList.toggle("rec", !!rec);
    var lab = rec ? t("vc.showBar") : t("vc.record");
    b.title = lab; b.setAttribute("aria-label", lab);
  }
  function mountButton(header, before) {
    if (!header || document.getElementById("btn-voice")) return;
    var b = iconBtn("icon-btn", "mic", t("vc.record"));
    b.id = "btn-voice";
    b.addEventListener("click", function (e) { e.stopPropagation(); start(); });
    header.insertBefore(b, before || null);
    micState();
  }

  // ---------- Playback ----------
  var audio = null, playing = null;   // one sound at a time
  var urls = {};                      // name → object URL (this page)
  var rows = [];                      // { name, ms, root, … } on screen

  function urlFor(name) {
    if (urls[name]) return Promise.resolve(urls[name]);
    var fs = fsApi(), path = V.pathOf(name);
    if (!fs || !path) return Promise.reject(new Error("no-disk"));
    return Promise.resolve(fs.read(path)).then(function (blob) {
      var typed = blob.type ? blob : new Blob([blob], { type: V.mimeOf(name) });
      urls[name] = URL.createObjectURL(typed);
      return urls[name];
    });
  }
  function forget(keep) {
    Object.keys(urls).forEach(function (n) {
      if (keep && keep[n]) return;
      if (playing === n) return;
      try { URL.revokeObjectURL(urls[n]); } catch (e) {}
      delete urls[n];
    });
  }
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("play", paint);
    audio.addEventListener("pause", paint);
    audio.addEventListener("ended", function () { paint(); });
    // MediaRecorder's webm carries no duration: read it by seeking far.
    audio.addEventListener("loadedmetadata", function () {
      if (audio.duration === Infinity) {
        audio._fix = true;
        audio.currentTime = 1e9;
      }
    });
    audio.addEventListener("durationchange", function () {
      if (audio._fix && isFinite(audio.duration)) { audio._fix = false; audio.currentTime = audio._want || 0; }
      paint();
    });
    return audio;
  }
  function durOf(row) {
    if (audio && playing === row.name && isFinite(audio.duration) && audio.duration > 0) return audio.duration * 1000;
    return row.ms;
  }
  function paint() {
    rows.forEach(function (row) {
      if (!row.root.isConnected) return;
      var on = audio && playing === row.name && !audio.paused;
      var pb = row.root.querySelector(".vc-play");
      pb.innerHTML = ICON[on ? "pause" : "play"];
      var lab = on ? t("vc.pausePlay") : t("vc.play");
      pb.title = lab; pb.setAttribute("aria-label", lab);
      var pos = audio && playing === row.name && !audio._fix ? audio.currentTime * 1000 : 0;
      var dur = durOf(row);
      row.root.querySelector(".vc-time").textContent = dur ? V.fmtDur(pos) + " / " + V.fmtDur(dur) : V.fmtDur(pos);
      var sk = row.root.querySelector(".vc-seek");
      sk.max = String(Math.max(1, Math.round(dur / 100)));
      if (!row.dragging) sk.value = String(Math.round(pos / 100));
    });
  }
  function toggle(row) {
    var a = ensureAudio();
    if (playing === row.name && !a.paused) { a.pause(); return; }
    if (playing === row.name && a.src) { a.play().catch(function () {}); return; }
    urlFor(row.name).then(function (u) {
      a.pause();
      playing = row.name;
      a._want = 0;
      a.src = u;
      a.playbackRate = row.rate || 1;
      return a.play();
    }).then(paint, function () { setMissing(row, true); });
  }
  function seek(row, ms) {
    var a = ensureAudio();
    if (playing !== row.name) {
      urlFor(row.name).then(function (u) {
        a.pause(); playing = row.name; a._want = ms / 1000; a.src = u;
        a.addEventListener("loadedmetadata", function once() {
          a.removeEventListener("loadedmetadata", once);
          if (!a._fix) a.currentTime = ms / 1000;
          paint();
        });
      }, function () { setMissing(row, true); });
      return;
    }
    if (a._fix) { a._want = ms / 1000; return; }
    a.currentTime = ms / 1000;
  }
  var RATES = [1, 1.5, 2];
  function nextRate(row) {
    var i = RATES.indexOf(row.rate || 1);
    row.rate = RATES[(i + 1) % RATES.length];
    row.root.querySelector(".vc-rate").textContent = row.rate + "×";
    if (audio && playing === row.name) audio.playbackRate = row.rate;
  }
  function setMissing(row, yes) {
    row.missing = yes;
    row.root.classList.toggle("missing", yes);
    row.root.querySelector(".vc-miss").hidden = !yes;
    row.root.querySelector(".vc-play").disabled = yes;
    row.root.querySelector(".vc-seek").disabled = yes;
  }
  function check(row) {
    var fs = fsApi(), path = V.pathOf(row.name);
    if (!fs || !path) { setMissing(row, true); return; }
    Promise.resolve(fs.stat(path)).then(function (st) { setMissing(row, !st || st.dir); }, function () { setMissing(row, true); });
  }

  // One player row. pageId: the page whose text names it.
  function playerRow(name, ms, pageId) {
    var root = el("div", "vc-row");
    root.setAttribute("data-name", name);
    var row = { name: name, ms: ms, pageId: pageId, root: root, rate: 1 };
    var pb = iconBtn("icon-btn vc-play", "play", t("vc.play"));
    pb.addEventListener("click", function () { toggle(row); });
    var mid = el("div", "vc-mid");
    var top = el("div", "vc-top");
    top.appendChild(el("span", "vc-when", whenOf(name)));
    top.appendChild(el("span", "vc-time", V.fmtDur(0) + (ms ? " / " + V.fmtDur(ms) : "")));
    var miss = el("span", "vc-miss", t("vc.missing")); miss.hidden = true;
    top.appendChild(miss);
    var sk = el("input", "vc-seek");
    sk.type = "range"; sk.min = "0"; sk.max = String(Math.max(1, Math.round(ms / 100))); sk.step = "1"; sk.value = "0";
    sk.setAttribute("aria-label", t("vc.seek"));
    sk.addEventListener("input", function () { row.dragging = true; });
    sk.addEventListener("change", function () { row.dragging = false; seek(row, +sk.value * 100); });
    mid.appendChild(top); mid.appendChild(sk);
    var rate = el("button", "vc-rate", "1×");
    rate.type = "button"; rate.title = t("vc.rate"); rate.setAttribute("aria-label", t("vc.rate"));
    rate.addEventListener("click", function () { nextRate(row); });
    var more = iconBtn("icon-btn vc-more", "more", t("vc.more"));
    more.setAttribute("aria-haspopup", "menu");
    more.addEventListener("click", function (e) { e.stopPropagation(); rowMenu(row, more); });
    [pb, mid, rate, more].forEach(function (x) { root.appendChild(x); });
    rows.push(row);
    check(row);
    return root;
  }

  function closeMenu() { var m = document.getElementById("vc-menu"); if (m) m.remove(); }
  function rowMenu(row, anchor) {
    if (document.getElementById("vc-menu")) { closeMenu(); return; }
    var m = el("div", "vc-menu");
    m.id = "vc-menu";
    m.setAttribute("role", "menu");
    function item(label, fn, danger) {
      var b = el("button", "vc-mi" + (danger ? " danger" : ""), label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { closeMenu(); fn(); });
      m.appendChild(b);
    }
    if (!row.missing) {
      item(t("vc.transcribe"), function () { transcribe(row); });
      item(t("vc.trim"), function () { trimDialog(row); });
      if (studioOk()) item(t("vc.studio"), function () { toStudio(row); });
      item(t("vc.download"), function () { download(row); });
    }
    item(t("vc.delete"), function () { del(row); }, true);
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + "px";
    m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
    var first = m.querySelector("button");
    if (first) first.focus();
    setTimeout(function () {
      document.addEventListener("click", function off(e) {
        if (m.contains(e.target)) return;
        document.removeEventListener("click", off, true);
        closeMenu();
      }, true);
    }, 0);
    m.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMenu(); anchor.focus(); } });
  }
  function download(row) {
    var fs = fsApi(), path = V.pathOf(row.name);
    if (!fs || !path) return;
    Promise.resolve(fs.read(path)).then(function (blob) {
      host.download(blob, row.name, V.mimeOf(row.name));
    }, function () { setMissing(row, true); });
  }

  // ---------- Delete (to Files' Trash) ----------
  function trash(name) {
    var fs = fsApi(), path = V.pathOf(name);
    if (!fs || !path || !FC) return Promise.reject(new Error("no-disk"));
    var now = Date.now(), id = FC.trashId(now, Math.random().toString(36).slice(2, 10));
    return Promise.resolve(fs.stat(path)).then(function (st) {
      if (!st || st.dir) throw new Error("ENOENT");
      return Promise.resolve(fs.writeText(FC.trashMetaPath(id), JSON.stringify(FC.makeMeta(path, false, now)))).then(function () {
        return Promise.resolve(fs.mv(path, FC.trashItemDir(id) + "/" + name)).catch(function (e) {
          return Promise.resolve(fs.rm(FC.trashMetaPath(id))).catch(function () {}).then(function () { throw e; });
        });
      });
    });
  }
  function del(row) {
    host.confirm(t("vc.delT"), row.missing ? t("vc.delMissing") : t("vc.delB"), t("vc.delete"), function () {
      if (audio && playing === row.name) { audio.pause(); playing = null; }
      var dropLine = function () {
        var p = host.page(row.pageId);
        if (p) host.setText(p.id, V.removeFrom(p.text || "", row.name), null);
      };
      if (row.missing) { dropLine(); return; }
      trash(row.name).then(function () {
        if (urls[row.name]) { try { URL.revokeObjectURL(urls[row.name]); } catch (e) {} delete urls[row.name]; }
        dropLine();
        host.toast(t("vc.trashed"));
      }, function () { host.toast(t("vc.delFail")); });
    });
  }

  // ---------- V2: shared helpers ----------
  var scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    var ver = ((document.querySelector('script[src*="notes.js?v="]') || { src: "" }).src.split("?v=")[1]) || "";
    scripts[src] = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = src + (ver ? "?v=" + encodeURIComponent(ver) : "");
      sc.onload = function () { res(); };
      sc.onerror = function () { sc.remove(); delete scripts[src]; rej(new Error("load " + src)); };
      document.head.appendChild(sc);
    });
    return scripts[src];
  }
  function readBlob(name) {
    var fs = fsApi(), path = V.pathOf(name);
    if (!fs || !path) return Promise.reject(new Error("no-disk"));
    return Promise.resolve(fs.read(path));
  }
  // The recording as an AudioBuffer (the browser's own decoder).
  function decode(name) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject(new Error("no-audio"));
    return readBlob(name).then(function (b) { return b.arrayBuffer(); }).then(function (ab) {
      return new Promise(function (res, rej) {
        var ac = new AC();
        var done = function (f, v) { try { ac.close(); } catch (e) {} f(v); };
        ac.decodeAudioData(ab, function (buf) { done(res, buf); }, function (e) { done(rej, e || new Error("decode")); });
      });
    });
  }
  // [from, to) ms of a buffer, mixed to mono and resampled to `rate`.
  function monoAt(buf, a, b, rate) {
    var sec = Math.max(0.05, (b - a) / 1000), OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error("no-audio"));
    var oc = new OAC(1, Math.max(1, Math.ceil(sec * rate)), rate), src = oc.createBufferSource();
    src.buffer = buf; src.connect(oc.destination); src.start(0, a / 1000, sec);
    return oc.startRendering().then(function (r) { return r.getChannelData(0); });
  }
  function busyDlg(title, onCancel) {
    var old = document.getElementById("vc-busy");
    if (old) old.remove();
    var dlg = el("dialog", "vc-dlg");
    dlg.id = "vc-busy";
    dlg.appendChild(el("h3", null, title));
    var st = el("p", "vc-dlg-p", "");
    st.setAttribute("aria-live", "polite");
    dlg.appendChild(st);
    var bar = el("div", "vc-prog"); bar.appendChild(el("i"));
    dlg.appendChild(bar);
    var row = el("div", "vc-dlg-row");
    if (onCancel) {
      var no = el("button", "vc-btn", t("dlg.cancel")); no.type = "button";
      no.addEventListener("click", function () { onCancel(); dlg.close(); });
      row.appendChild(no);
    }
    dlg.appendChild(row);
    dlg.addEventListener("cancel", function (e) { if (!onCancel) e.preventDefault(); else onCancel(); });
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return {
      say: function (txt, f) { st.textContent = txt; if (f != null) bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; },
      close: function () { if (dlg.open) dlg.close(); }
    };
  }

  // ---------- V2: trim (always a NEW file; the old one to the Trash) ----------
  function trimDialog(row) {
    var b = busyDlg(t("vc.trimT"), null);
    b.say(t("vc.reading"), 0);
    decode(row.name).then(function (buf) {
      b.close();
      return buf.numberOfChannels ? openTrim(row, buf) : null;
    }, function () { b.close(); host.toast(t("vc.decodeFail")); });
  }
  function openTrim(row, buf) {
    var dur = Math.round(buf.duration * 1000);
    var ch0 = buf.getChannelData(0);
    var dlg = el("dialog", "vc-dlg vc-trim");
    dlg.id = "vc-trim";
    dlg.appendChild(el("h3", null, t("vc.trimT")));
    dlg.appendChild(el("p", "vc-dlg-p", t("vc.trimB")));
    var wrap = el("div", "vc-wave");
    var cv = el("canvas");
    cv.setAttribute("aria-hidden", "true");
    wrap.appendChild(cv);
    dlg.appendChild(wrap);
    function slider(label) {
      var lab = el("label", "vc-tr-row");
      lab.appendChild(el("span", "vc-tr-lab", label));
      var r = el("input"); r.type = "range"; r.min = "0"; r.max = String(dur); r.step = "100";
      lab.appendChild(r);
      var v = el("span", "vc-tr-val");
      lab.appendChild(v);
      dlg.appendChild(lab);
      return { r: r, v: v };
    }
    var sa = slider(t("vc.trimStart")), sb = slider(t("vc.trimEnd"));
    sa.r.value = "0"; sb.r.value = String(dur);
    var info = el("p", "vc-dlg-p vc-tr-len", "");
    dlg.appendChild(info);
    var rowEl = el("div", "vc-dlg-row");
    var play = el("button", "vc-btn", t("vc.trimPlay")); play.type = "button";
    var no = el("button", "vc-btn", t("dlg.cancel")); no.type = "button";
    var go = el("button", "vc-btn primary", t("vc.trimSave")); go.type = "button";
    rowEl.appendChild(play); rowEl.appendChild(no); rowEl.appendChild(go);
    dlg.appendChild(rowEl);
    var pk = null, src = null, pac = null;
    function range() { return V.clampTrim(+sa.r.value, +sb.r.value, dur); }
    function stopPlay() {
      try { if (src) src.stop(); } catch (e) {}
      try { if (pac) pac.close(); } catch (e2) {}
      src = null; pac = null;
      play.textContent = t("vc.trimPlay");
    }
    function draw() {
      var w = Math.max(200, Math.round(wrap.clientWidth || 300)), h = 72, dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + "px"; cv.style.height = h + "px";
      var g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!pk || pk.length !== w) pk = V.peaks(ch0, w);
      var cs = getComputedStyle(dlg), on = cs.getPropertyValue("--accent").trim() || "#d4af37", off = cs.getPropertyValue("--text-dim").trim() || "#888";
      var rg = range(), x0 = rg.a / dur * w, x1 = rg.b / dur * w;
      g.clearRect(0, 0, w, h);
      for (var x = 0; x < w; x++) {
        var ph = Math.max(1, pk[x] * (h - 4));
        g.fillStyle = x >= x0 && x <= x1 ? on : off;
        g.globalAlpha = x >= x0 && x <= x1 ? 1 : 0.35;
        g.fillRect(x, (h - ph) / 2, 1, ph);
      }
      g.globalAlpha = 1;
      g.fillStyle = on;
      g.fillRect(Math.max(0, x0 - 1), 0, 2, h);
      g.fillRect(Math.min(w - 2, x1 - 1), 0, 2, h);
      sa.v.textContent = V.fmtDur(rg.a);
      sb.v.textContent = V.fmtDur(rg.b);
      info.textContent = tf("vc.trimLen", { dur: V.fmtDur(rg.b - rg.a) });
    }
    function sync(e) {
      var a = +sa.r.value, bb = +sb.r.value;
      if (bb - a < V.MIN_TRIM_MS) {
        if (e && e.target === sa.r) sa.r.value = String(Math.max(0, bb - V.MIN_TRIM_MS));
        else sb.r.value = String(Math.min(dur, a + V.MIN_TRIM_MS));
      }
      stopPlay();
      draw();
    }
    sa.r.addEventListener("input", sync);
    sb.r.addEventListener("input", sync);
    play.addEventListener("click", function () {
      if (src) { stopPlay(); return; }
      var AC = window.AudioContext || window.webkitAudioContext, rg = range();
      if (!AC) return;
      pac = new AC();
      src = pac.createBufferSource();
      src.buffer = buf; src.connect(pac.destination);
      src.onended = function () { if (src) stopPlay(); };
      src.start(0, rg.a / 1000, (rg.b - rg.a) / 1000);
      play.textContent = t("vc.trimStop");
    });
    no.addEventListener("click", function () { dlg.close(); });
    go.addEventListener("click", function () {
      var rg = range();
      dlg.close();
      if (rg.a <= 0 && rg.b >= dur) return;            // nothing cut
      saveTrim(row, buf, rg);
    });
    dlg.addEventListener("close", function () { stopPlay(); window.removeEventListener("resize", draw); dlg.remove(); });
    window.addEventListener("resize", draw);
    document.body.appendChild(dlg);
    dlg.showModal();
    draw();
  }
  // Opus (Ogg) through Studio's encoder where the browser has WebCodecs
  // AudioEncoder; else a 22 kHz 16-bit WAV. → { blob, ext }
  function encodeMono(buf, rg) {
    return loadScript("../studio/encode.js").then(function () {
      var E = window.StudioEncode;
      return E && E.opusSupported ? E.opusSupported() : false;
    }, function () { return false; }).then(function (opus) {
      if (opus) {
        return monoAt(buf, rg.a, rg.b, 48000).then(function (s) {
          return window.StudioEncode.encodeOpus([s], 32, {});
        }).then(function (bytes) { return { blob: new Blob([bytes], { type: "audio/ogg" }), ext: "ogg" }; });
      }
      return monoAt(buf, rg.a, rg.b, 22050).then(function (s) {
        return { blob: new Blob([V.wav16(s, 22050)], { type: "audio/wav" }), ext: "wav" };
      });
    });
  }
  function saveTrim(row, buf, rg) {
    var b = busyDlg(t("vc.trimT"), null);
    b.say(t("vc.trimming"), 0.3);
    var old = row.name, pageId = row.pageId;
    encodeMono(buf, rg).then(function (out) {
      b.say(t("vc.saving"), 0.8);
      return writeFile(out.blob, Date.now(), out.ext);
    }).then(function (name) {
      var p = host.page(pageId), ms = rg.b - rg.a;
      if (p) host.setText(p.id, V.replaceIn(p.text || "", old, name, ms), null);
      if (audio && playing === old) { audio.pause(); playing = null; }
      // the untrimmed file to the Trash only once the page names the new one
      return trash(old).then(function () { b.close(); host.toast(t("vc.trimmed")); },
        function () { b.close(); host.toast(t("vc.trimmedKept")); });
    }, function () { b.close(); host.toast(t("vc.trimFail")); });
  }

  // ---------- V2: transcription on this device (Montage's Whisper) ----------
  var MAX_ASR_MS = 30 * 60 * 1000;
  function transcribe(row) {
    loadScript("../montage/asr.js").then(function () {
      var ASR = window.MontageASR;
      if (!ASR || !(window.OfflineAudioContext || window.webkitOfflineAudioContext)) throw new Error("no-asr");
      return Promise.resolve(ASR.ready()).catch(function () { return false; }).then(function (yes) {
        if (yes) { runAsr(row, ASR); return; }
        host.ask(t("vc.asrT"), tf("vc.asrNeed", { mb: ASR.MODEL_MB + ASR.RUNTIME_MB }), [
          { label: t("dlg.cancel") },
          { label: t("vc.asrGo"), primary: true, fn: function () { runAsr(row, ASR); } }
        ]);
      });
    }).catch(function () { host.toast(t("vc.asrNo")); });
  }
  function runAsr(row, ASR) {
    var stop = false, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var b = busyDlg(t("vc.asrT"), function () { stop = true; if (ctl) ctl.abort(); });
    b.say(t("vc.reading"), 0);
    var name = row.name, pageId = row.pageId, cut = false;
    decode(name).then(function (buf) {
      if (stop) throw new Error("stop");
      var dur = buf.duration * 1000, end = Math.min(dur, MAX_ASR_MS);
      cut = dur > MAX_ASR_MS;
      return monoAt(buf, 0, end, 16000);
    }).then(function (samples) {
      if (stop) throw new Error("stop");
      return ASR.run(samples, {
        lang: V.asrLang(host.locale), signal: ctl ? ctl.signal : undefined,
        cancelled: function () { return stop; },
        progress: function (q, stage) {
          if (!stop) b.say(tf(stage === "download" ? "vc.asrDl" : "vc.asrRun", { p: Math.round(q * 100) }), q);
        }
      });
    }).then(function (r) {
      if (stop) return;
      b.close();
      var text = V.transcriptText((r && r.cues) || []);
      if (!text) { host.toast(t("vc.asrNone")); return; }
      var p = host.page(pageId);
      var next = p ? V.insertAfter(p.text || "", name, text) : null;
      if (next === null) { host.toast(t("vc.asrGone")); return; }
      host.setText(p.id, next, null);
      host.toast(cut ? t("vc.asrCut") : t("vc.asrDone"));
    }, function (e) {
      if (stop) return;
      b.close();
      host.toast(e && /^http|fetch|network|load/i.test(String(e.message || e)) ? t("vc.asrNet") : t("vc.asrFail"));
    });
  }

  // ---------- V2: send to Studio ----------
  function shell() { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function studioOk() {
    var w = shell();
    try { return !!(w && w.orosFileOpen && typeof w.orosFileOpen.hand === "function" && typeof w.__orosOpenAt === "function"); }
    catch (e) { return false; }
  }
  function toStudio(row) {
    var w = shell();
    readBlob(row.name).then(function (blob) {
      var file = new File([blob], row.name, { type: blob.type || V.mimeOf(row.name) });
      var tok = w.orosFileOpen.hand(file);
      if (!tok) throw new Error("hand");
      w.__orosOpenAt("studio", { openFile: { token: tok } });
    }).catch(function () { host.toast(t("vc.studioFail")); });
  }

  // ---------- The page's recordings: strip and preview ----------
  var stripKey = null;
  function renderStrip(page) {
    var items = page ? V.listIn(page.text || "") : [];
    var key = page ? page.id + "|" + items.map(function (v) { return v.name + ":" + v.ms; }).join(",") : "";
    var old = document.getElementById("voice-strip");
    micState();
    if (old && key === stripKey) return;
    stripKey = key;
    if (old) old.remove();
    rows = rows.filter(function (r) { return r.root.isConnected; });
    var keep = {};
    items.forEach(function (v) { keep[v.name] = true; });
    forget(keep);
    if (!items.length) return;
    var strip = el("div", "voice-strip");
    strip.id = "voice-strip";
    strip.appendChild(el("div", "lk-section", t("vc.strip")));
    items.forEach(function (v) { strip.appendChild(playerRow(v.name, v.ms, page.id)); });
    var pane = document.getElementById("editor-pane");
    var links = document.getElementById("links-strip");
    if (links && links.parentNode === pane) pane.insertBefore(strip, links);
    else if (pane) pane.appendChild(strip);
    paint();
  }
  // Fills the preview's <div class="md-voice"> blocks (md.js) with players.
  function hydrate(pv, page) {
    if (!pv || !page) return;
    rows = rows.filter(function (r) { return r.root.isConnected; });
    var blocks = pv.querySelectorAll("div.md-voice[data-voice]");
    for (var i = 0; i < blocks.length; i++) {
      var name = blocks[i].getAttribute("data-voice");
      if (!V.isName(name)) continue;
      blocks[i].textContent = "";
      blocks[i].appendChild(playerRow(name, +blocks[i].getAttribute("data-ms") || 0, page.id));
    }
    paint();
  }

  // ---------- Unused recordings (notebook menu, only on request) ----------
  function openUnused() {
    var fs = fsApi();
    if (!fs) { host.toast(t("vc.noDisk")); return; }
    Promise.resolve(fs.ls(V.DIR)).catch(function () { return []; }).then(function (list) {
      var files = (list || []).filter(function (e) { return !e.dir; }).map(function (e) { return { name: e.name }; });
      var texts = host.pages().map(function (p) { return p.text || ""; });
      var cand = V.unused(texts, files, Date.now());
      if (!cand.length) { host.toast(t("vc.noUnused")); return; }
      return Promise.all(cand.map(function (f) {
        return Promise.resolve(fs.stat(V.pathOf(f.name))).then(function (st) { f.size = st && st.size || 0; return f; }, function () { return null; });
      })).then(function (r) { unusedDialog(r.filter(Boolean)); });
    });
  }
  function unusedDialog(files) {
    var old = document.getElementById("vc-unused");
    if (old) old.remove();
    var dlg = el("dialog", "vc-dlg");
    dlg.id = "vc-unused";
    dlg.appendChild(el("h3", null, t("vc.unusedT")));
    dlg.appendChild(el("p", "vc-dlg-p", t("vc.unusedB")));
    var list = el("div", "vc-ulist");
    var boxes = [];
    files.forEach(function (f) {
      var lab = el("label", "vc-uitem");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = true;
      boxes.push({ cb: cb, f: f });
      lab.appendChild(cb);
      lab.appendChild(el("span", "vc-uname", whenOf(f.name)));
      lab.appendChild(el("span", "vc-usize", tf("vc.mb", { mb: mb(f.size) })));
      list.appendChild(lab);
    });
    dlg.appendChild(list);
    var row = el("div", "vc-dlg-row");
    var no = el("button", "vc-btn", t("dlg.cancel")); no.type = "button";
    no.addEventListener("click", function () { dlg.close(); });
    var go = el("button", "vc-btn primary danger", t("vc.toTrash")); go.type = "button";
    go.addEventListener("click", function () {
      var pick = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.f.name; });
      dlg.close();
      if (!pick.length) return;
      var ok = 0;
      pick.reduce(function (p, n) {
        return p.then(function () { return trash(n).then(function () { ok++; }, function () {}); });
      }, Promise.resolve()).then(function () { host.toast(tf("vc.trashedN", { n: ok })); });
    });
    row.appendChild(no); row.appendChild(go);
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- Recovery after a closed tab or a crash ----------
  function recover() {
    idbAll("recs").then(function (list) {
      var r = (list || []).filter(function (x) { return x && x.rid && (!rec || rec.rid !== x.rid); })
        .sort(function (a, b) { return a.at - b.at; })[0];
      if (!r) { if (!rec) liveFlag(false); return; }
      var pg = host.page(r.page);
      host.ask(t("vc.recoverT"), tf(pg ? "vc.recoverB" : "vc.recoverB2", { dur: V.fmtDur(r.ms || 0), title: pg ? (pg.title || t("page.untitled")) : "" }), [
        { label: t("vc.discard"), fn: function () { idbDrop(r.rid).then(recover, function () {}); } },
        { label: t("vc.recover"), primary: true, fn: function () {
          idbChunks(r.rid).then(function (parts) {
            var blob = new Blob(parts, { type: String(r.mime || "").split(";")[0] || "audio/webm" });
            if (!blob.size) return idbDrop(r.rid);
            return save(r.rid, r.page, blob, r.at, r.ext || V.extForMime(r.mime), r.ms || 0, false);
          }).then(recover, function () { host.toast(t("vc.saveFail")); });
        } }
      ]);
    }, function () {});
  }

  // ---------- Wiring ----------
  function init(h) {
    host = h;
    if (!V) return null;
    // A hidden tab may be frozen or killed: hand over what is recorded.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && rec && !rec.pauseAt && !rec.saving) {
        try { rec.mr.requestData(); } catch (e) {}
      }
    });
    var v = vaultApi();
    if (v && typeof v.onStatus === "function") {
      var unsub = v.onStatus(function (kind, d) {
        if (kind !== "stats" || !d || !(d.downloaded > 0)) return;
        rows.forEach(function (r) { if (r.missing && r.root.isConnected) check(r); });
      });
      window.addEventListener("pagehide", function () { if (typeof unsub === "function") unsub(); });
    }
    setTimeout(recover, 1200);
    return api;
  }

  var api = {
    init: init, mountButton: mountButton, renderStrip: renderStrip, hydrate: hydrate,
    openUnused: openUnused, start: start, stop: stop, isRecording: function () { return !!rec; },
    canRecord: canRecord, voiceLine: V ? V.voiceLine : null
  };
  window.OrosNotesVoiceUI = api;
})();
