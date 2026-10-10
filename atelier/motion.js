// ============================================================
// orOS Atelier — motion (v1.0.0): animation, present, video, GIF
//   - Animate panel: an entrance per element (fade, rise, pop, wipe,
//     typewriter), and per page its duration and the transition to
//     it (anim.js keeps the timing rules)
//   - Play: previews the current page's animation on the stage
//   - Present: full screen with designkit/show.js (keys, clicker,
//     touch, transitions); pages show as they end up
//   - Video: the design as a film, recorded from a canvas with the
//     browser's MediaRecorder (MP4 where supported, else WebM), in
//     real time, nothing leaves the device
//   - GIF: the same film at 10 frames per second (gif.js)
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, T = AT.T, AX = AT.AX, A = AT.A, t = AT.t, el = AT.el, ED = AT.ed;
  var Anim = window.AtelierAnim, Gif = window.AtelierGif;

  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function sec(title) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    return s;
  }
  function pages(doc) { return M.pagesInOrder(doc); }

  // ---------- Preview on the stage ----------
  // Plays the page: entrances, and its videos and sound for as long
  // as the page shows. Play again (or another page) stops it.
  var playing = 0, sess = null;
  function play() {
    var doc = AT.doc;
    if (!doc) return;
    if (sess) { stopPlay(); return; }
    ED.exitText();
    var my = ++playing, pg = ED.pg;
    var items = doc.items.filter(function (it) { return it.pg === pg; }).sort(M.byZ);
    var end = Anim.introLen(items) + 0.3;
    var page = pages(doc).filter(function (p) { return p.id === pg; })[0];
    var s = AT.video && page ? AT.video.Session(doc, [page]) : null;
    (s ? s.prepare() : Promise.resolve()).then(function () {
      if (my !== playing) { if (s) s.stop(); return; }
      if (s && !s.empty()) { sess = s; ED.media = s.media; end = Math.max(end, s.timeline.total); }
      else if (s) s.stop();
      if (end <= 0.3) { AT.toast(t("an.nothing")); return; }
      var t0 = performance.now();
      (function frame() {
        if (my !== playing) return;
        if (ED.pg !== pg || AT.doc !== doc) { stopPlay(); return; }
        var sec = (performance.now() - t0) / 1000;
        if (sec >= end) { stopPlay(); return; }
        if (sess) sess.sync(sec, true);
        ED.animTime = sec;
        ED.redraw();
        requestAnimationFrame(frame);
      })();
    });
  }
  function stopPlay() {
    playing++;
    if (sess) { sess.stop(); sess = null; }
    ED.media = undefined;
    if (ED.animTime !== undefined) ED.animTime = undefined;
    ED.redraw();
  }
  AT.on("open", function () { if (sess) stopPlay(); });

  // ---------- Animate panel ----------
  function view(body) {
    var doc = AT.doc;
    var list = ED.selItems().filter(function (it) { return !it.ax.bg; });
    var s1 = sec(t("an.element"));
    if (!list.length) s1.appendChild(el("p", "hint", t("an.pick")));
    else {
      var cur = list[0].ax.an || "";
      var g = el("div", "an-grid");
      [""].concat(Anim.ANIMS).forEach(function (id) {
        if (id === "type" && !list.every(function (it) { return it.ax.k === "text"; })) return;
        var b = btn("an-tile" + (cur === id ? " on" : ""), t("an." + (id || "none")), function () {
          AT.editItems(list.map(function (it) { return it.id; }), function (it) {
            if (id) it.ax.an = id; else delete it.ax.an;
          });
          AT.renderDrawer();
          if (id) play();
        });
        b.setAttribute("aria-pressed", cur === id ? "true" : "false");
        g.appendChild(b);
      });
      s1.appendChild(g);
    }
    body.appendChild(s1);

    var bg = AX.background(doc, ED.pg);
    var s2 = sec(t("an.page"));
    if (bg) {
      var row = el("label", "rng-row");
      row.appendChild(el("span", "rng-l", t("an.dur")));
      var r = el("input", "rng");
      r.type = "range"; r.min = Anim.DUR_MIN; r.max = 30; r.step = 1; r.value = bg.ax.dur || Anim.DUR_DEF;
      var v = el("span", "rng-v", (bg.ax.dur || Anim.DUR_DEF) + " s");
      r.addEventListener("input", function () {
        AT.beginGesture();
        var n = Number(r.value);
        v.textContent = n + " s";
        AT.editItems([bg.id], function (it) { if (n === Anim.DUR_DEF) delete it.ax.dur; else it.ax.dur = n; });
      });
      r.addEventListener("change", function () { AT.endGesture(); });
      row.appendChild(r); row.appendChild(v);
      s2.appendChild(row);
      if (pages(doc)[0].id !== ED.pg) {
        s2.appendChild(el("div", "fld-lbl", t("an.tr")));
        var chips = el("div", "chips");
        var ptr = bg.ax.ptr || Anim.PTR_DEF;
        Anim.TRANSITIONS.forEach(function (id) {
          chips.appendChild(btn("chip-btn" + (ptr === id ? " on" : ""), t("an.tr." + id), function () {
            AT.editItems([bg.id], function (it) { if (id === Anim.PTR_DEF) delete it.ax.ptr; else it.ax.ptr = id; });
            AT.renderDrawer();
          }));
        });
        s2.appendChild(chips);
      }
    }
    body.appendChild(s2);

    if (bg && AT.video) AT.video.pageSection(body, bg);

    var s3 = sec();
    s3.appendChild(btn("btn small primary block", t(sess ? "an.stop" : "an.play"), function () { play(); AT.renderDrawer(); }));
    s3.appendChild(el("p", "hint", t("an.hint")));
    body.appendChild(s3);
  }
  AT.registerView("animate", view);

  // ---------- Present ----------
  // Pages with a video or entrance animations are live in the show
  // (designkit show.js redraws them while they move); the pages'
  // sound and the videos play in step with the page on screen.
  function present() {
    var doc = AT.doc, S = window.orosDK.show;
    if (!doc || !S) return;
    ED.exitText(); stopPlay();
    var list = pages(doc);
    var idx = Math.max(0, list.findIndex(function (p) { return p.id === ED.pg; }));
    var sess = AT.video ? AT.video.Session(doc, list) : null;
    var intro = list.map(function (p) {
      return Anim.introLen(doc.items.filter(function (it) { return it.pg === p.id; }).sort(function (a, b) { return a.z - b.z; }));
    });
    var hasVid = list.map(function (p) {
      return doc.items.some(function (it) { return it.pg === p.id && !it.hide && it.ax && it.ax.vid; });
    });
    // start() needs the click's user gesture (full screen), so no
    // waiting here: the open design's fonts and pictures are loaded,
    // a video shows its first frame until it has loaded.
    var ctl = S.start({
      count: list.length,
      aspect: doc.setup.w / doc.setup.h,
      startAt: idx,
      lang: AT.LANG,
      live: function (i, t) { return hasVid[i] || t < intro[i] + 0.1; },
      renderSlide: function (i, canvas, cssW, cssH, t) {
        var sc = canvas.width / doc.setup.w;
        AT.draw.renderPage(doc, list[i], sc, { canvas: canvas, maxSide: 0, background: "#ffffff",
          time: t, media: t !== undefined && sess ? sess.media : undefined });
      },
      title: function (i) { return t("pg.n", { n: i + 1 }); },
      transition: function (i) { return list[i] && i ? Anim.pageTransition(doc, list[i].id) : "none"; }
    });
    presentSound(ctl, sess);
  }
  function presentSound(ctl, s) {
    if (!ctl || !s) return;
    s.prepare().then(function () {
      if (s.empty()) { s.stop(); return; }
      var tl = s.timeline, last = -2;
      (function tick() {
        var st = ctl.state();
        if (st.closed) { s.stop(); return; }
        // past the page's duration the clips run on by themselves
        // (syncing to a fixed time would keep seeking them back)
        var p = tl.pages[st.index], lt = st.t || 0;
        if (p && (lt < p.dur - 0.05 || st.index !== last)) s.sync(p.t0 + Math.min(p.dur - 0.05, lt), true);
        last = st.index;
        setTimeout(tick, 250);
      })();
    });
  }

  // ---------- Film (video + GIF) ----------
  // One frame of the film on ctx (w × h px).
  function filmPainter(doc, list, w, h, media) {
    var sc = w / doc.setup.w;
    var a = document.createElement("canvas"), b = document.createElement("canvas");
    a.width = b.width = w; a.height = b.height = h;
    function pageTo(cv, pg, time) {
      AT.draw.renderPage(doc, pg, sc, { canvas: cv, maxSide: 0, background: "#ffffff", time: time, media: media });
      return cv;
    }
    var tl = Anim.timeline(doc, list);
    return {
      total: tl.total,
      draw: function (ctx, s) {
        var p = Anim.at(tl, s);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        var cur = pageTo(a, list[p.i], p.local);
        if (p.prev < 0) { ctx.drawImage(cur, 0, 0); return; }
        var prev = pageTo(b, list[p.prev], undefined), m = p.mix;
        if (p.tr === "push") { ctx.drawImage(prev, -m * w, 0); ctx.drawImage(cur, (1 - m) * w, 0); return; }
        ctx.drawImage(prev, 0, 0);
        if (p.tr === "slide") { ctx.drawImage(cur, (1 - m) * w, 0); return; }
        ctx.globalAlpha = m;
        if (p.tr === "zoom") {
          var k = 0.85 + 0.15 * m;
          ctx.drawImage(cur, w * (1 - k) / 2, h * (1 - k) / 2, w * k, h * k);
        } else ctx.drawImage(cur, 0, 0);
        ctx.globalAlpha = 1;
      }
    };
  }
  function filmSize(doc, side) {
    var k = side / Math.max(doc.setup.w, doc.setup.h);
    return { w: Math.max(2, Math.round(doc.setup.w * k / 2) * 2), h: Math.max(2, Math.round(doc.setup.h * k / 2) * 2) };
  }

  var VIDEO_TYPES = [
    ["video/mp4;codecs=avc1.42E01E", ".mp4"], ["video/mp4", ".mp4"],
    ["video/webm;codecs=vp9", ".webm"], ["video/webm;codecs=vp8", ".webm"], ["video/webm", ".webm"]
  ];
  // with a sound track
  var AV_TYPES = [
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", ".mp4"],
    ["video/webm;codecs=vp9,opus", ".webm"], ["video/webm;codecs=vp8,opus", ".webm"], ["video/webm", ".webm"]
  ];
  function videoType(sound) {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
    var list = sound ? AV_TYPES : VIDEO_TYPES;
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i][0])) return list[i];
    return null;
  }
  function canVideo() {
    return !!videoType() && typeof HTMLCanvasElement !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
  }

  // Real time: the browser records what the canvas shows, and the
  // sound of the videos and pages (session, video.js).
  function recordVideo(doc, list, side, onTick, sess) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var sound = !!(sess && sess.hasSound() && AC);
    var vt = (sound && videoType(true)) || videoType(false);
    if (!vt) return Promise.reject(new Error("novideo"));
    if (sound && vt[0].indexOf(",") < 0 && vt[0] !== "video/webm") sound = false;
    var sz = filmSize(doc, side), film = filmPainter(doc, list, sz.w, sz.h, sess ? sess.media : null);
    var cv = document.createElement("canvas");
    cv.width = sz.w; cv.height = sz.h;
    var ctx = cv.getContext("2d");
    film.draw(ctx, 0);
    var actx = null, stream = cv.captureStream(30);
    if (sound) {
      try {
        actx = new AC();
        var dest = actx.createMediaStreamDestination();
        sess.connect(actx, dest);
        stream = new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks()));
      } catch (e) { actx = null; }
    }
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var rec = new MediaRecorder(stream, { mimeType: vt[0], videoBitsPerSecond: Math.round(sz.w * sz.h * 30 * 0.15) });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function () { reject(new Error("record")); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        if (actx) actx.close().then(null, function () {});
        resolve({ blob: new Blob(chunks, { type: vt[0].split(";")[0] }), ext: vt[1] });
      };
      if (actx && actx.state === "suspended") actx.resume();
      rec.start(500);
      var t0 = performance.now(), last = -1;
      (function tick() {
        var s = (performance.now() - t0) / 1000;
        if (sess) sess.sync(Math.min(s, film.total - 0.01), true);
        film.draw(ctx, Math.min(s, film.total));
        var whole = Math.floor(s);
        if (whole !== last) { last = whole; if (onTick) onTick(whole, Math.ceil(film.total)); }
        if (s >= film.total + 0.2) { rec.stop(); return; }
        setTimeout(tick, 1000 / 30);
      })();
    });
  }

  // Offline: frame by frame (videos seeked to each frame), then encoded.
  function makeGif(doc, list, side, onTick, sess) {
    var media = sess && sess.hasVideo() ? sess : null;
    var sz = filmSize(doc, side), film = filmPainter(doc, list, sz.w, sz.h, media ? media.media : null);
    var fps = film.total > 60 ? 5 : 10, n = Math.min(900, Math.ceil(film.total * fps));
    var cv = document.createElement("canvas");
    cv.width = sz.w; cv.height = sz.h;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    var frames = [], i = 0;
    function one() {
      film.draw(ctx, i / fps);
      frames.push({ idx: Gif.quantize(ctx.getImageData(0, 0, sz.w, sz.h).data, sz.w, sz.h), delay: 100 / fps });
      i++;
    }
    return new Promise(function (resolve) {
      (function step() {
        if (media && i < n) {
          media.sync(i / fps, false).then(function () {
            one();
            if (onTick) onTick(Math.floor(i / fps), Math.ceil(film.total));
            step();
          });
          return;
        }
        var stop = performance.now() + 30;
        while (i < n && performance.now() < stop) one();
        if (onTick) onTick(Math.floor(i / fps), Math.ceil(film.total));
        if (i < n) { setTimeout(step, 0); return; }
        resolve({ blob: new Blob([Gif.encode({ w: sz.w, h: sz.h, frames: frames, loop: 0 })], { type: "image/gif" }), ext: ".gif" });
      })();
    });
  }

  // o: { type "video"|"gif", side (px), pages "all"|"cur" }
  function exportFilm(o, save) {
    var doc = AT.doc;
    if (!doc) return Promise.resolve(false);
    ED.exitText(); stopPlay();
    var list = pages(doc);
    if (o.pages === "cur") list = list.filter(function (p) { return p.id === ED.pg; });
    var key = o.type === "gif" ? "exp.gifWorking" : "exp.videoWorking";
    var sess = AT.video ? AT.video.Session(doc, list) : null;
    return T.load(AT.draw.fontKeys(doc)).then(function () {
      return Promise.all(AX.assetIds(doc).map(function (id) { return A.load(id); }).concat(sess ? [sess.prepare()] : []));
    }).then(function () {
      var tick = function (s, total) { AT.toast(t(key, { s: s, t: total })); };
      return o.type === "gif" ? makeGif(doc, list, o.side, tick, sess) : recordVideo(doc, list, o.side, tick, sess);
    }).then(function (r) {
      if (sess) sess.stop();
      var mime = r.blob.type || (r.ext === ".gif" ? "image/gif" : "video/webm");
      return save(r.blob, r.ext, mime);
    }, function (e) { if (sess) sess.stop(); throw e; });
  }

  AT.motion = { play: play, stop: stopPlay, present: present, exportFilm: exportFilm, canVideo: canVideo, filmSize: filmSize, duration: function (doc, pages) { return Anim.timeline(doc, pages).total; } };
})();
