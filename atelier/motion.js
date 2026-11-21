// ============================================================
// orOS Atelier — motion (v2.0.0): animation, present, video, GIF
//   - Animate panel: per element an entrance, an exit and an emphasis
//     from Canva's effects (wave CV-A: direction, speed, by line /
//     word / letter, start and end time), per page an animation for
//     every element, its duration and the transition to it (anim.js
//     keeps the timing rules), Morph among them (wave C2, morph.js:
//     the previous page turns into this one)
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
    var from = morphFrom(doc, pg), lead = from ? Anim.MORPH : 0;
    var end = Anim.introLen(items, Anim.pageAnim(doc, pg)) + lead + 0.3;
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
        ED.animTime = sec - lead;
        ED.morph = from && sec < lead ? { from: from, p: Anim.easeInOut(sec / lead) } : undefined;
        ED.redraw();
        requestAnimationFrame(frame);
      })();
    });
  }
  function stopPlay() {
    playing++;
    if (sess) { sess.stop(); sess = null; }
    ED.media = undefined;
    ED.morph = undefined;
    if (ED.animTime !== undefined) ED.animTime = undefined;
    ED.redraw();
  }
  AT.on("open", function () { if (sess) stopPlay(); });
  // the page before pg when pg morphs in from it, else ""
  function morphFrom(doc, pg) {
    var list = pages(doc), i = list.findIndex(function (p) { return p.id === pg; });
    return i > 0 && Anim.pageTransition(doc, pg) === "morph" ? list[i - 1].id : "";
  }

  // ---------- Animate panel ----------
  // As in Canva (wave CV-A): per element an entrance, an exit and an
  // emphasis (anim.js EFFECTS / EMPHASIS), each with its direction,
  // speed and, for a text, by line / word / letter; when it starts and
  // ends on the page. Stored in ext.anim (R39); ax.an keeps the
  // nearest older entrance so older orOS copies still animate.
  var animTab = "in";
  function specFor(it) {
    var a = Anim.norm(it.ext && it.ext.anim);
    if (a) return a;
    var s = Anim.specOf(it, null);
    return s ? JSON.parse(JSON.stringify(s)) : {};
  }
  function writeAnim(it, a) {
    a = Anim.norm(a);
    it.ext = it.ext || {};
    if (a) it.ext.anim = a; else delete it.ext.anim;
    if (!Object.keys(it.ext).length) delete it.ext;
    var old = Anim.legacy(a);
    if (old) it.ax.an = old; else delete it.ax.an;
  }
  function editAnim(list, fn, replay) {
    AT.editItems(list.map(function (it) { return it.id; }), function (it) { var a = specFor(it); fn(a, it); writeAnim(it, a); });
    AT.renderDrawer();
    if (replay) play();
  }
  function chipRow(ids, cur, label, fn) {
    var c = el("div", "chips");
    ids.forEach(function (id) {
      var b = btn("chip-btn" + (cur === id ? " on" : ""), label(id), function () { fn(id); });
      b.setAttribute("aria-pressed", cur === id ? "true" : "false");
      c.appendChild(b);
    });
    return c;
  }
  function rangeRow(label, min, max, step, val, show, fn) {
    var row = el("label", "rng-row");
    row.appendChild(el("span", "rng-l", label));
    var r = el("input", "rng");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = val;
    var v = el("span", "rng-v", show(val));
    r.addEventListener("input", function () { AT.beginGesture(); v.textContent = show(Number(r.value)); fn(Number(r.value)); });
    r.addEventListener("change", function () { AT.endGesture(); });
    row.appendChild(r); row.appendChild(v);
    return row;
  }
  // effect tiles for a part ("in" | "out" | "pan"), text effects only
  // when every element is a text
  function effectGrid(cur, allText, pick) {
    var g = el("div", "an-grid");
    [""].concat(Anim.EFFECT_IDS).forEach(function (id) {
      if (id && Anim.EFFECTS[id][3] && !allText) return;
      var b = btn("an-tile" + (cur === id ? " on" : ""), id ? t("an.e." + id) : t("an.none"), function () { pick(id); });
      b.setAttribute("aria-pressed", cur === id ? "true" : "false");
      g.appendChild(b);
    });
    return g;
  }
  // direction, speed and by-unit of one part
  function partControls(box, part, allText, set) {
    if (!part) return;
    var E = Anim.EFFECTS[part.e];
    if (E[1]) {
      box.appendChild(el("div", "fld-lbl", t("an.dir")));
      box.appendChild(chipRow(Anim.DIRS, part.d || E[1], function (d) { return t("an.dir." + d); }, function (d) { set({ d: d }, true); }));
    }
    if (part.e !== "typewriter") box.appendChild(rangeRow(t("an.speed"), 0.25, 4, 0.25, part.sp || 1, function (v) { return "×" + v; }, function (v) { set({ sp: v }); }));
    if (allText && part.e !== "typewriter") {
      box.appendChild(el("div", "fld-lbl", t("an.by")));
      box.appendChild(chipRow(Anim.BYS, part.by || "el", function (b) { return t("an.by." + b); }, function (b) { set({ by: b }, true); }));
    }
  }
  function timeField(label, val, fn) {
    var row = el("label", "fld-row an-time");
    row.appendChild(el("span", "fld-lbl", label));
    var i = el("input", "fld");
    i.type = "number"; i.min = 0; i.max = Anim.DUR_MAX; i.step = 0.1; i.placeholder = t("an.auto");
    i.value = val === undefined ? "" : String(val);
    i.addEventListener("change", function () { var v = i.value.trim(); fn(v === "" ? undefined : Number(v)); });
    row.appendChild(i);
    return row;
  }
  function view(body) {
    var doc = AT.doc;
    if (AT.magicDesign) AT.magicDesign.section(body);
    var list = ED.selItems().filter(function (it) { return !it.ax.bg; });
    var s1 = sec(t("an.element"));
    if (!list.length) s1.appendChild(el("p", "hint", t("an.pick")));
    else {
      var allText = list.every(function (it) { return it.ax.k === "text"; });
      var a0 = specFor(list[0]);
      s1.appendChild(chipRow(["in", "out", "em"], animTab, function (k) {
        return t("an.tab." + k) + ((k === "in" ? a0["in"] : k === "out" ? a0.out : a0.em) ? " •" : "");
      }, function (k) { animTab = k; AT.renderDrawer(); }));
      if (animTab === "em") {
        var cur = a0.em ? a0.em.e : "", g = el("div", "an-grid");
        [""].concat(Anim.EMPHASIS_IDS).forEach(function (id) {
          var b = btn("an-tile" + (cur === id ? " on" : ""), id ? t("an.m." + id) : t("an.none"), function () {
            editAnim(list, function (a) { if (id) a.em = { e: id }; else delete a.em; }, !!id);
          });
          b.setAttribute("aria-pressed", cur === id ? "true" : "false");
          g.appendChild(b);
        });
        s1.appendChild(g);
        if (a0.em) s1.appendChild(rangeRow(t("an.speed"), 0.25, 4, 0.25, a0.em.sp || 1, function (v) { return "×" + v; }, function (v) {
          AT.editItems(list.map(function (it) { return it.id; }), function (it) { var a = specFor(it); if (a.em) a.em.sp = v; writeAnim(it, a); });
        }));
      } else {
        var key = animTab, part = a0[key];
        if (part && Anim.EFFECTS[part.e][3] && !allText) part = null;
        s1.appendChild(effectGrid(part ? part.e : "", allText, function (id) {
          editAnim(list, function (a) {
            if (!id) { delete a[key]; return; }
            var keep = a[key] && a[key].e === id ? a[key] : { e: id };
            a[key] = keep;
          }, !!id);
        }));
        partControls(s1, part, allText, function (ch, replay) {
          var edit = function (a) { if (!a[key]) return; Object.keys(ch).forEach(function (k) { a[key][k] = ch[k]; }); };
          if (replay) editAnim(list, edit, true);
          else AT.editItems(list.map(function (it) { return it.id; }), function (it) { var a = specFor(it); edit(a); writeAnim(it, a); });
        });
      }
      // when on the page (seconds; empty = in turn / until the page ends)
      var tm = el("div", "an-times");
      tm.appendChild(timeField(t("an.t0"), a0.t0, function (v) { editAnim(list, function (a) { if (v > 0) a.t0 = v; else delete a.t0; }); }));
      tm.appendChild(timeField(t("an.t1"), a0.t1, function (v) { editAnim(list, function (a) { if (v > 0) a.t1 = v; else delete a.t1; }); }));
      s1.appendChild(tm);
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
      // page animation: every element without its own entrance
      s2.appendChild(el("div", "fld-lbl", t("an.pageAnim")));
      var pan = Anim.pageAnim(doc, ED.pg);
      s2.appendChild(effectGrid(pan ? pan.e : "", false, function (id) {
        AT.editItems([bg.id], function (it) {
          it.ext = it.ext || {};
          if (id) it.ext.pan = { e: id }; else delete it.ext.pan;
          if (!Object.keys(it.ext).length) delete it.ext;
        });
        AT.renderDrawer();
        if (id) play();
      }));
      if (pan) s2.appendChild(el("p", "hint", t("an.pageAnimHint")));
      if (pages(doc)[0].id !== ED.pg) {
        s2.appendChild(el("div", "fld-lbl", t("an.tr")));
        var chips = el("div", "chips");
        var ptr = Anim.pageTransition(doc, ED.pg);
        // Morph lives in ext.mph; ptr stays what older copies show
        Anim.TRANSITIONS.concat(["morph"]).forEach(function (id) {
          var b = btn("chip-btn" + (ptr === id ? " on" : ""), t("an.tr." + id), function () {
            AT.editItems([bg.id], function (it) {
              if (id === "morph") { it.ext = it.ext || {}; it.ext.mph = 1; return; }
              if (it.ext && it.ext.mph) { delete it.ext.mph; if (!Object.keys(it.ext).length) delete it.ext; }
              if (id === Anim.PTR_DEF) delete it.ax.ptr; else it.ax.ptr = id;
            });
            AT.renderDrawer();
            if (id === "morph") play();
          });
          b.setAttribute("aria-pressed", ptr === id ? "true" : "false");
          chips.appendChild(b);
        });
        s2.appendChild(chips);
        if (ptr === "morph") s2.appendChild(el("p", "hint", t("an.morphHint")));
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
      return Anim.introLen(doc.items.filter(function (it) { return it.pg === p.id; }).sort(function (a, b) { return a.z - b.z; }), Anim.pageAnim(doc, p.id));
    });
    // an emphasis goes on for as long as the page shows
    var loops = list.map(function (p) {
      return doc.items.some(function (it) { var a = it.pg === p.id && !it.hide && Anim.norm(it.ext && it.ext.anim); return !!(a && a.em); });
    });
    var hasVid = list.map(function (p) {
      return doc.items.some(function (it) { return it.pg === p.id && !it.hide && it.ax && (it.ax.vid || (it.ext && it.ext.gif)); });
    });
    // A morph is drawn here, not by show.js: only when the show came
    // from the page before (not on a jump, Previous or the first page
    // shown). show.js asks transition(i) before it draws page i, while
    // `shown` (onChange) still names the page it leaves.
    var morph = list.map(function (p, i) { return i > 0 && Anim.pageTransition(doc, p.id) === "morph"; });
    var shown = -1, morphTo = -1;
    function lead(i) { return morphTo === i ? Anim.MORPH : 0; }
    // start() needs the click's user gesture (full screen), so no
    // waiting here: the open design's fonts and pictures are loaded,
    // a video shows its first frame until it has loaded.
    var ctl = S.start({
      count: list.length,
      aspect: doc.setup.w / doc.setup.h,
      startAt: idx,
      lang: AT.BASE,
      live: function (i, t) { return hasVid[i] || loops[i] || t < intro[i] + lead(i) + 0.1; },
      renderSlide: function (i, canvas, cssW, cssH, t) {
        var sc = canvas.width / doc.setup.w, L = lead(i);
        AT.draw.renderPage(doc, list[i], sc, { canvas: canvas, maxSide: 0, background: "#ffffff",
          time: t === undefined ? t : t - L, media: t !== undefined && sess ? sess.media : undefined,
          morph: t !== undefined && t < L ? { from: list[i - 1].id, p: Anim.easeInOut(t / L) } : undefined });
      },
      title: function (i) { return t("pg.n", { n: i + 1 }); },
      transition: function (i) {
        if (!list[i] || !i) return "none";
        if (i !== shown) morphTo = morph[i] && shown === i - 1 ? i : -1;
        if (morph[i]) {
          var bg = AX.background(doc, list[i].id);
          return morphTo === i ? "none" : (bg && bg.ax.ptr) || Anim.PTR_DEF;
        }
        return Anim.pageTransition(doc, list[i].id);
      },
      onChange: function (st) { shown = st.index; if (st.index !== morphTo) morphTo = -1; }
    });
    presentSound(ctl, sess);
    // chart pictures at screen size, then the slide draws again
    if (ctl && AT.charts) {
      var sw = Math.max(window.screen ? window.screen.width : 0, window.innerWidth) * (window.devicePixelRatio || 1);
      AT.charts.prepare(doc, sw / doc.setup.w, list).then(function () {
        if (ctl.refresh && !ctl.state().closed) ctl.refresh();
      });
    }
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
    function pageTo(cv, pg, time, morph) {
      AT.draw.renderPage(doc, pg, sc, { canvas: cv, maxSide: 0, background: "#ffffff", time: time, media: media, morph: morph });
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
        var mo = p.tr === "morph" && p.prev >= 0 ? { from: list[p.prev].id, p: p.mix } : undefined;
        var cur = pageTo(a, list[p.i], p.pt, mo);
        if (p.prev < 0 || mo) { ctx.drawImage(cur, 0, 0); return; }
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
      var fs = filmSize(doc, o.side);
      return AT.charts ? AT.charts.prepare(doc, fs.w / doc.setup.w, list) : null;
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
