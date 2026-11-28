// ============================================================
// orOS Workouts — camera.js: count reps with the camera (v1.0.0)
// On the device only: the camera picture goes to MoveNet
// SinglePose Lightning (Google, Apache-2.0; ONNX from
// koulaxizis/oros-models-vision, SHA-256 checked) in ONNX Runtime
// Web (MIT, vendor/ort, WebAssembly, one thread). Only 17 body
// points come out; fitness/reps-core.js turns them into reps or a
// hold's seconds. No frame is recorded, kept or sent anywhere.
//   - the model and the runtime are fetched once, when the person
//     asks, and kept in IndexedDB "oros-fitness-ai" (removed by the
//     factory reset and by Settings › Remove the camera model)
//   - count out loud: speechSynthesis with a voice on this device
//     only (localService, rule 30), off by default
//   - finishes by itself after IDLE seconds without movement (on by
//     default), so the set is ticked and the rest timer starts
// Exposes window.OrosFitnessCamera.
// ============================================================
(function (root) {
  "use strict";

  var SIDE = 192;
  var MODEL = {
    url: "https://koulaxizis.github.io/oros-models-vision/movenet/movenet-lightning.onnx",
    sha: "e74c62a3e9a8d7942355855ba3e9ca6eeb2e06fbcd8e4d8ceb5c291b2a03d663",
    mb: 9.4
  };
  var FILES = {
    js:   { url: "../vendor/ort/ort.wasm.min.js", v: "ort1.22.0" },
    mjs:  { url: "../vendor/ort/ort-wasm-simd-threaded.mjs", v: "ort1.22.0" },
    wasm: { url: "../vendor/ort/ort-wasm-simd-threaded.wasm", v: "ort1.22.0" },
    model: { url: MODEL.url, v: MODEL.sha, sha: MODEL.sha }
  };
  var APPROX_MB = 21;            // runtime (11 MB) + model (9.4 MB), a first download
  var DB_NAME = "oros-fitness-ai";

  // ---------- Files (IndexedDB) ----------
  var dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("files", mode), res, r = fn(t.objectStore("files"));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { resolve(res); };
        t.onerror = t.onabort = function () { reject(t.error || new Error("idb")); };
      });
    });
  }
  function stored(name) {
    return tx("readonly", function (s) { return s.get(name); }).then(function (rec) {
      return rec && rec.v === FILES[name].v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function fetchFile(url, onBytes, signal) {
    return fetch(url, { cache: "no-cache", signal: signal }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { onBytes(b.size); return b; });
      var reader = res.body.getReader(), parts = [];
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts);
          parts.push(r.value); onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    });
  }
  // → { name: Blob }; a model whose SHA-256 differs is refused ("hash").
  function files(onProgress, signal) {
    var names = Object.keys(FILES), got = {}, done = 0, total = APPROX_MB * 1024 * 1024;
    return names.reduce(function (p, name) {
      return p.then(function () {
        return stored(name).then(function (b) {
          if (b) { got[name] = b; return; }
          return fetchFile(FILES[name].url, function (n) {
            done += n;
            if (onProgress) onProgress(Math.min(0.99, done / total));
          }, signal).then(function (blob) {
            if (!FILES[name].sha) return blob;
            return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (d) {
              if (hex(d) !== FILES[name].sha) throw new Error("hash");
              return blob;
            });
          }).then(function (blob) {
            got[name] = blob;
            return tx("readwrite", function (s) { s.put({ v: FILES[name].v, blob: blob }, name); }).catch(function () {});
          });
        });
      });
    }, Promise.resolve()).then(function () { if (onProgress) onProgress(1); return got; });
  }
  function forget() {
    sessP = null;
    return tx("readwrite", function (s) { s.clear(); }).catch(function () {});
  }

  // ---------- Runtime ----------
  var sessP = null, wasmSet = false;
  function loadScript(blob) {
    return new Promise(function (resolve, reject) {
      if (root.ort && root.ort.InferenceSession) { resolve(); return; }
      var s = document.createElement("script");
      s.src = URL.createObjectURL(new Blob([blob], { type: "text/javascript" }));
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("script")); };
      document.head.appendChild(s);
    });
  }
  function session(onProgress, signal) {
    if (sessP) return sessP;
    var p = sessP = files(onProgress, signal).then(function (f) {
      return loadScript(f.js).then(function () {
        var ort = root.ort;
        if (!ort || !ort.InferenceSession) throw new Error("runtime");
        if (!wasmSet) {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
          ort.env.wasm.wasmPaths = {
            mjs: URL.createObjectURL(new Blob([f.mjs], { type: "text/javascript" })),
            wasm: URL.createObjectURL(new Blob([f.wasm], { type: "application/wasm" }))
          };
          wasmSet = true;
        }
        return f.model.arrayBuffer().then(function (buf) {
          return ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] });
        });
      });
    });
    p.catch(function () { if (sessP === p) sessP = null; });
    return p;
  }

  // ---------- Voice (local only) ----------
  function localVoice(lang) {
    try {
      var l = String(lang || "en").toLowerCase().split(/[-_]/)[0];
      var vs = root.speechSynthesis ? root.speechSynthesis.getVoices() : [];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v && v.localService === true && String(v.lang || "").toLowerCase().split(/[-_]/)[0] === l) return v;
      }
    } catch (e) {}
    return null;
  }
  function say(text, lang) {
    var v = localVoice(lang);
    if (!v) return false;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 1.1;
      root.speechSynthesis.cancel();
      root.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  // ---------- The camera dialog ----------
  // o: { ui: { t, el, iconBtn, button, makeDialog, openDialog, live, lang },
  //      exName, kind ("r" | "wr" | "t"), profile (reps-core),
  //      setLabel, prefs: { get(k), set(k, v) },
  //      fmtTime(sec), onDone({ reps, sec, auto }) }
  function open(o) {
    var R = root.OrosFitnessReps, ui = o.ui, t = ui.t, el = ui.el;
    var hold = !!o.profile.hold;
    var dlg = ui.makeDialog("fit-cam", (hold ? t("cam.btnHold") : t("cam.btn")) + " · " + o.exName, true);
    dlg.classList.add("cam-dlg");
    var body = el("div", "cam-body");
    var stage = el("div", "cam-stage");
    var cv = el("canvas", "cam-view");
    cv.setAttribute("aria-hidden", "true");
    stage.appendChild(cv);
    var big = el("div", "cam-count", hold ? o.fmtTime(0) : "0");
    big.setAttribute("aria-live", "off");
    var unit = el("div", "cam-unit", hold ? "" : t("cam.reps"));
    var cnt = el("div", "cam-num");
    cnt.appendChild(big); cnt.appendChild(unit);
    stage.appendChild(cnt);
    var msg = el("p", "cam-msg", "");
    msg.setAttribute("role", "status");
    var side = el("div", "cam-side");
    body.appendChild(stage);
    body.appendChild(side);
    side.appendChild(msg);

    var opts = el("div", "cam-opts");
    function toggle(key, label, def) {
      var lab = el("label", "chk");
      var cb = el("input");
      cb.type = "checkbox";
      var v = o.prefs.get(key);
      cb.checked = v == null ? def : !!v;
      cb.addEventListener("change", function () { o.prefs.set(key, cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(el("span", "", label));
      opts.appendChild(lab);
      return cb;
    }
    var voiceCb = toggle("camVoice", t("cam.voice"), false);
    var autoCb = toggle("camAuto", t("cam.auto"), true);
    voiceCb.addEventListener("change", function () {
      if (voiceCb.checked && !localVoice(ui.lang)) { msg.textContent = t("cam.voiceNone"); ui.live(t("cam.voiceNone")); }
    });
    side.appendChild(opts);
    dlg.appendChild(body);

    var row = el("div", "dlg-actions");
    var flip = ui.button(t("cam.flip"), "", function () { facing = facing === "user" ? "environment" : "user"; startCamera(); });
    flip.hidden = true;
    var cancel = ui.button(t("cam.cancel"), "", function () { dlg.close(); });
    var doneBtn = ui.button(t("cam.done"), "primary", function () { finish(false); });
    row.appendChild(flip);
    row.appendChild(cancel);
    row.appendChild(doneBtn);
    dlg.appendChild(row);

    var stream = null, video = null, raf = 0, busy = false, closed = false, counter = R.Counter(o.profile);
    var kp = null, lb = null, facing = "user", wake = null, lastHint = null, lastHintT = 0, lastSpoken = -1, ctl = null;
    var small = document.createElement("canvas");
    small.width = small.height = SIDE;
    var sg = small.getContext("2d", { willReadFrequently: true });
    var input = new Uint8Array(SIDE * SIDE * 3);

    dlg.addEventListener("close", stopAll);
    function stopAll() {
      closed = true;
      cancelAnimationFrame(raf);
      if (ctl) try { ctl.abort(); } catch (e) {}
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      if (wake) try { wake.release(); } catch (e) {}
      wake = null;
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) {}
      document.removeEventListener("visibilitychange", onVis);
    }
    function finish(auto) {
      if (closed) return;
      var st = counter.state;
      var out = hold ? { sec: Math.round(st.hold), auto: auto } : { reps: st.reps, auto: auto };
      dlg.close();
      if ((hold ? out.sec : out.reps) > 0) o.onDone(out);
    }
    // Hidden (another app in front, screen off): the camera goes off;
    // back in front it comes on again and the count goes on.
    var wasOn = false;
    function onVis() {
      if (closed) return;
      if (document.hidden) {
        wasOn = !!stream;
        cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
        stream = null;
      } else if (wasOn) { wasOn = false; startCamera(); }
    }
    document.addEventListener("visibilitychange", onVis);

    // The first use asks before anything is downloaded.
    ui.openDialog(dlg);
    ready().then(function (have) {
      if (closed) return;
      if (have) { load(); return; }
      msg.textContent = t("cam.intro") + " " + t("cam.download", { mb: APPROX_MB });
      var go = ui.button(t("cam.start"), "primary", function () { go.remove(); load(); });
      doneBtn.hidden = true;
      row.appendChild(go);
      go.focus();
    });

    function load() {
      doneBtn.hidden = false;
      msg.textContent = t("cam.preparing");
      ctl = root.AbortController ? new AbortController() : null;
      session(function (p) { if (p < 1) msg.textContent = t("cam.loading", { p: Math.round(p * 100) }); }, ctl && ctl.signal)
        .then(function () { if (!closed) startCamera(); })
        .catch(function (e) {
          if (closed) return;
          msg.textContent = String(e && e.message) === "hash" ? t("cam.hash") : t("cam.failed");
        });
    }
    function startCamera() {
      if (stream) stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
      stream = null;
      cancelAnimationFrame(raf);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = t("cam.noCam"); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
        .then(function (s) {
          if (closed) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
          stream = s;
          video = video || document.createElement("video");
          video.muted = true; video.playsInline = true; video.setAttribute("playsinline", "");
          video.srcObject = s;
          return video.play().then(function () {
            stage.classList.toggle("mirror", facing === "user");
            msg.textContent = hold ? t("cam.holdReady") : (o.profile.auto ? t("cam.learn") : t("cam.ready"));
            navigator.mediaDevices.enumerateDevices().then(function (l) {
              flip.hidden = l.filter(function (d) { return d.kind === "videoinput"; }).length < 2;
            }).catch(function () {});
            try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { wake = w; }).catch(function () {}); } catch (e) {}
            raf = requestAnimationFrame(frame);
          });
        })
        .catch(function () { if (!closed) msg.textContent = t("cam.noCam"); });
    }

    function frame() {
      if (closed || !video || !stream) return;
      raf = requestAnimationFrame(frame);
      var w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      var g = cv.getContext("2d");
      g.drawImage(video, 0, 0, w, h);
      if (kp && lb) drawSkeleton(g, kp, lb, w);
      if (busy) return;
      busy = true;
      lb = lb && lb.w === w && lb.h === h ? lb : Object.assign(R.letterbox(w, h, SIDE), { w: w, h: h });
      sg.fillStyle = "#000";
      sg.fillRect(0, 0, SIDE, SIDE);
      sg.drawImage(video, lb.ox, lb.oy, lb.dw, lb.dh);
      var px = sg.getImageData(0, 0, SIDE, SIDE).data;
      for (var i = 0, j = 0; i < px.length; i += 4) { input[j++] = px[i]; input[j++] = px[i + 1]; input[j++] = px[i + 2]; }
      var tNow = performance.now() / 1000;
      session().then(function (sess) {
        var feeds = {};
        feeds[sess.inputNames[0]] = new root.ort.Tensor("uint8", input, [1, SIDE, SIDE, 3]);
        return sess.run(feeds).then(function (out) { return out[sess.outputNames[0]].data; });
      }).then(function (data) {
        busy = false;
        if (closed) return;
        kp = R.unpack(data);
        show(counter.feed(kp, tNow), tNow);
      }, function () { busy = false; });
    }

    function drawSkeleton(g, pts, box, w) {
      var p = pts.map(function (k) { return R.toPicture(k, box, SIDE); });
      var lw = Math.max(2, w / 160);
      g.lineWidth = lw;
      g.lineCap = "round";
      g.strokeStyle = "rgba(120, 230, 160, 0.9)";
      R.BONES.forEach(function (b) {
        var a = p[b[0]], c = p[b[1]];
        if (a[2] < R.MIN_SCORE || c[2] < R.MIN_SCORE) return;
        g.beginPath(); g.moveTo(a[1], a[0]); g.lineTo(c[1], c[0]); g.stroke();
      });
      g.fillStyle = "#fff";
      p.forEach(function (k) {
        if (k[2] < R.MIN_SCORE) return;
        g.beginPath(); g.arc(k[1], k[0], lw * 1.6, 0, Math.PI * 2); g.fill();
      });
    }

    function show(st, tNow) {
      if (hold) {
        big.textContent = o.fmtTime(Math.floor(st.hold));
        var whole = Math.floor(st.hold);
        if (voiceCb.checked && whole > 0 && whole % 10 === 0 && whole !== lastSpoken) { lastSpoken = whole; say(String(whole), ui.lang); }
      } else {
        big.textContent = String(st.reps);
        if (st.newRep) {
          ui.live(String(st.reps));
          if (voiceCb.checked) say(String(st.reps), ui.lang);
        }
      }
      var text;
      if (!st.seen) text = t("cam.notSeen");
      else if (st.calibrating) text = t("cam.learn");
      else if (st.hint) text = t("hint." + st.hint);
      else text = hold ? (st.phase === "hold" ? "" : t("cam.holdReady")) : (st.reps ? "" : t("cam.ready"));
      if (msg.textContent !== text) msg.textContent = text;
      if (st.hint && (st.hint !== lastHint || tNow - lastHintT > 8)) {
        if (voiceCb.checked && tNow - lastHintT > 4 && !st.newRep) say(t("hint." + st.hint), ui.lang);
        lastHint = st.hint; lastHintT = tNow;
      }
      if (st.idle && autoCb.checked) finish(true);
    }
  }

  root.OrosFitnessCamera = { open: open, ready: ready, forget: forget, MODEL: MODEL, DB_NAME: DB_NAME, APPROX_MB: APPROX_MB };
})(typeof self !== "undefined" ? self : this);
