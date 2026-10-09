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
  var playing = 0;
  function play() {
    var doc = AT.doc;
    if (!doc) return;
    ED.exitText();
    var items = doc.items.filter(function (it) { return it.pg === ED.pg; }).sort(M.byZ);
    var end = Anim.introLen(items) + 0.3;
    if (end <= 0.3) { AT.toast(t("an.nothing")); return; }
    var my = ++playing, t0 = performance.now();
    function frame() {
      if (my !== playing) return;
      var s = (performance.now() - t0) / 1000;
      ED.animTime = s < end ? s : undefined;
      ED.redraw();
      if (s < end) requestAnimationFrame(frame);
    }
    frame();
  }
  function stopPlay() { playing++; if (ED.animTime !== undefined) { ED.animTime = undefined; ED.redraw(); } }

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

    var s3 = sec();
    s3.appendChild(btn("btn small primary block", t("an.play"), play));
    s3.appendChild(el("p", "hint", t("an.hint")));
    body.appendChild(s3);
  }
  AT.registerView("animate", view);

  // ---------- Present ----------
  function present() {
    var doc = AT.doc, S = window.orosDK.show;
    if (!doc || !S) return;
    ED.exitText(); stopPlay();
    var list = pages(doc);
    var idx = Math.max(0, list.findIndex(function (p) { return p.id === ED.pg; }));
    // start() needs the click's user gesture (full screen), so no
    // waiting here: the open design's fonts and pictures are loaded.
    S.start({
      count: list.length,
      aspect: doc.setup.w / doc.setup.h,
      startAt: idx,
      lang: AT.LANG,
      renderSlide: function (i, canvas) {
        var sc = canvas.width / doc.setup.w;
        AT.draw.renderPage(doc, list[i], sc, { canvas: canvas, maxSide: 0, background: "#ffffff" });
      },
      title: function (i) { return t("pg.n", { n: i + 1 }); },
      transition: function (i) { return list[i] && i ? Anim.pageTransition(doc, list[i].id) : "none"; }
    });
  }

  // ---------- Film (video + GIF) ----------
  // One frame of the film on ctx (w × h px).
  function filmPainter(doc, list, w, h) {
    var sc = w / doc.setup.w;
    var a = document.createElement("canvas"), b = document.createElement("canvas");
    a.width = b.width = w; a.height = b.height = h;
    function pageTo(cv, pg, time) {
      AT.draw.renderPage(doc, pg, sc, { canvas: cv, maxSide: 0, background: "#ffffff", time: time });
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
  function videoType() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
    for (var i = 0; i < VIDEO_TYPES.length; i++) if (MediaRecorder.isTypeSupported(VIDEO_TYPES[i][0])) return VIDEO_TYPES[i];
    return null;
  }
  function canVideo() {
    return !!videoType() && typeof HTMLCanvasElement !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
  }

  // Real time: the browser records what the canvas shows.
  function recordVideo(doc, list, side, onTick) {
    var vt = videoType();
    if (!vt) return Promise.reject(new Error("novideo"));
    var sz = filmSize(doc, side), film = filmPainter(doc, list, sz.w, sz.h);
    var cv = document.createElement("canvas");
    cv.width = sz.w; cv.height = sz.h;
    var ctx = cv.getContext("2d");
    film.draw(ctx, 0);
    return new Promise(function (resolve, reject) {
      var stream = cv.captureStream(30), chunks = [];
      var rec = new MediaRecorder(stream, { mimeType: vt[0], videoBitsPerSecond: Math.round(sz.w * sz.h * 30 * 0.15) });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function () { reject(new Error("record")); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        resolve({ blob: new Blob(chunks, { type: vt[0].split(";")[0] }), ext: vt[1] });
      };
      rec.start(500);
      var t0 = performance.now(), last = -1;
      (function tick() {
        var s = (performance.now() - t0) / 1000;
        film.draw(ctx, Math.min(s, film.total));
        var whole = Math.floor(s);
        if (whole !== last) { last = whole; if (onTick) onTick(whole, Math.ceil(film.total)); }
        if (s >= film.total + 0.2) { rec.stop(); return; }
        setTimeout(tick, 1000 / 30);
      })();
    });
  }

  // Offline: frame by frame, then encoded.
  function makeGif(doc, list, side, onTick) {
    var sz = filmSize(doc, side), film = filmPainter(doc, list, sz.w, sz.h);
    var fps = film.total > 60 ? 5 : 10, n = Math.min(900, Math.ceil(film.total * fps));
    var cv = document.createElement("canvas");
    cv.width = sz.w; cv.height = sz.h;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    var frames = [], i = 0;
    return new Promise(function (resolve) {
      (function step() {
        var stop = performance.now() + 30;
        while (i < n && performance.now() < stop) {
          film.draw(ctx, i / fps);
          frames.push({ idx: Gif.quantize(ctx.getImageData(0, 0, sz.w, sz.h).data, sz.w, sz.h), delay: 100 / fps });
          i++;
        }
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
    return T.load(AT.draw.fontKeys(doc)).then(function () {
      return Promise.all(AX.assetIds(doc).map(function (id) { return A.load(id); }));
    }).then(function () {
      var tick = function (s, total) { AT.toast(t(key, { s: s, t: total })); };
      return o.type === "gif" ? makeGif(doc, list, o.side, tick) : recordVideo(doc, list, o.side, tick);
    }).then(function (r) {
      var mime = r.blob.type || (r.ext === ".gif" ? "image/gif" : "video/webm");
      return save(r.blob, r.ext, mime);
    });
  }

  AT.motion = { play: play, stop: stopPlay, present: present, exportFilm: exportFilm, canVideo: canVideo, filmSize: filmSize, duration: function (doc, pages) { return Anim.timeline(doc, pages).total; } };
})();
