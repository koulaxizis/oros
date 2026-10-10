// ============================================================
// orOS Atelier — Video and sound (v1.0.0)
//   - Uploads › "Add video or sound": a video becomes an element
//     (a photo whose picture is its first frame, so crop, mask,
//     filters, position and animation work as for a photo); a sound
//     becomes the sound of the current page
//   - Video panel (context bar): trim, sound on/off, volume, loop,
//     fit the page's duration to the video
//   - Page sound (Animate panel): volume, start, all pages
//   - Session: plays the clips of a design in step with the film
//     (Play, Present, video and GIF export; motion.js)
// Files: atelier/clips.js (ids, types, timing). Stored on the orOS
// disk like the pictures and synced by Vault Drive per file.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, A = AT.A, AX = AT.AX, t = AT.t, el = AT.el, ED = AT.ed;
  var CL = window.AtelierClips, Anim = window.AtelierAnim;

  function fs() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  function pathOf(id) { return A.FOLDER + "/" + id; }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(blob) {
    return blob.arrayBuffer().then(function (ab) { return crypto.subtle.digest("SHA-256", ab); }).then(hex);
  }
  function fail(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- files ----------
  var urls = {};
  // blob: URL of a clip on this device, or null (not synced here yet)
  function url(id) {
    if (!CL.isVideo(id) && !CL.isSound(id)) return Promise.resolve(null);
    if (urls[id]) return urls[id];
    var F = fs();
    if (!F) return Promise.resolve(null);
    var p = urls[id] = F.read(pathOf(id)).then(function (b) {
      return URL.createObjectURL(new Blob([b], { type: CL.mimeOf(id) }));
    }, function () { delete urls[id]; return null; });
    return p;
  }
  function blob(id) {
    var F = fs();
    if (!F || (!CL.isVideo(id) && !CL.isSound(id))) return Promise.resolve(null);
    return F.read(pathOf(id)).then(null, function () { return null; });
  }
  function head(b) { return b.slice(0, 16).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }

  // the browser reads the file: → <video> with its metadata
  function probe(src) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement("video");
      var timer = setTimeout(function () { done(fail("decode")); }, 20000);
      function done(err) {
        clearTimeout(timer);
        v.onloadedmetadata = v.onerror = null;
        if (err) reject(err); else resolve(v);
      }
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadedmetadata = function () { done(null); };
      v.onerror = function () { done(fail("decode")); };
      v.src = src;
    });
  }
  function seekTo(v, s) {
    return new Promise(function (resolve) {
      if (Math.abs(v.currentTime - s) < 0.01 && v.readyState >= 2) { resolve(); return; }
      var timer = setTimeout(end, 3000);
      function end() { clearTimeout(timer); v.removeEventListener("seeked", end); resolve(); }
      v.addEventListener("seeked", end);
      v.currentTime = s;
    });
  }
  // the first proper frame as a picture asset (the element's poster)
  function poster(v, name) {
    var at = Math.min(0.5, (v.duration || 0) / 3);
    return seekTo(v, at).then(function () {
      var w = v.videoWidth, h = v.videoHeight, s = Math.min(1, 1920 / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { if (b) resolve(b); else reject(fail("decode")); }, "image/jpeg", 0.9);
      });
    }).then(function (b) {
      return A.importFile(new File([b], String(name || "video").replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" }));
    });
  }

  // File → { id, kind "video"|"sound", dur, w, h, name, poster? }
  // Rejects with code: nofs | type | decode | big | long
  function importClip(file) {
    var F = fs();
    if (!F) return Promise.reject(fail("nofs"));
    var kind = "", src = "", v = null;
    return head(file).then(function (b) {
      kind = CL.sniff(b);
      if (!kind) throw fail("type");
      if (file.size > CL.MAX_VIDEO) throw fail("big");
      src = URL.createObjectURL(file);
      return probe(src);
    }).then(function (vv) {
      v = vv;
      var pic = v.videoWidth > 0 && v.videoHeight > 0;
      var ext = CL.extFor(kind, pic);
      if (!ext) throw fail("type");
      if (!pic && file.size > CL.MAX_SOUND) throw fail("big");
      var dur = isFinite(v.duration) ? v.duration : 0;
      if (dur > CL.MAX_LEN) throw fail("long");
      return sha256(file).then(function (h) {
        var id = h + "." + ext;
        return F.stat(pathOf(id)).then(function () { return null; }, function () { return F.write(pathOf(id), file); }).then(function () {
          var res = { id: id, kind: pic ? "video" : "sound", dur: Math.round(dur * 100) / 100, w: v.videoWidth, h: v.videoHeight, name: String(file.name || "").slice(0, 120) };
          if (!pic) return res;
          return poster(v, file.name).then(function (p) { res.poster = p; return res; });
        });
      });
    }).then(function (res) {
      cleanup();
      return res;
    }, function (e) { cleanup(); throw e; });
    function cleanup() {
      if (v) { v.removeAttribute("src"); try { v.load(); } catch (e) {} }
      if (src) URL.revokeObjectURL(src);
    }
  }

  // A clip from a package: the hash and the type are checked.
  function put(id, b) {
    var F = fs();
    if (!F || (!CL.isVideo(id) && !CL.isSound(id))) return Promise.reject(fail("badid"));
    return Promise.all([sha256(b), head(b)]).then(function (r) {
      if (r[0] + id.slice(64) !== id) throw fail("hash");
      var k = CL.sniff(r[1]), ext = CL.extOf(id);
      if (!k || [CL.extFor(k, true), CL.extFor(k, false)].indexOf(ext) < 0) throw fail("type");
      return F.stat(pathOf(id)).then(function () { return null; }, function () { return F.write(pathOf(id), b); });
    }).then(function () { return id; });
  }

  function errText(e) {
    var c = e && (e.code || e.message);
    if (c === "nofs") return t("img.nofs");
    if (c === "type") return t("vd.type");
    if (c === "big") return t("vd.big");
    if (c === "long") return t("vd.long");
    return t("vd.fail");
  }

  // ---------- adding ----------
  function placeVideo(res) {
    var s = AT.doc.setup, p = res.poster, k = Math.min(s.w * 0.6 / p.w, s.h * 0.6 / p.h);
    ED.add({ k: "photo", a: p.id, iw: p.w, ih: p.h, nm: res.name || "", w: p.w * k, h: p.h * k, fit: "fill", vid: res.id });
  }
  function setPageSound(id) {
    var bg = AX.background(AT.doc, ED.pg);
    if (!bg) return false;
    AT.editItems([bg.id], function (it) { it.ax.au = id; delete it.ax.ao; delete it.ax.av; });
    return true;
  }
  function upload() {
    if (!AT.doc) return;
    AT.io.pickFile("video/*,audio/*,.mp4,.webm,.mov,.m4v,.mp3,.m4a,.ogg,.oga,.opus,.wav").then(function (f) {
      if (!f) return;
      AT.toast(t("vd.working"));
      return importClip(f).then(function (res) {
        if (res.kind === "video") { AT.noteUpload(res.poster.id); placeVideo(res); AT.toast(t("vd.added")); }
        else if (setPageSound(res.id)) { AT.toast(t("vd.soundAdded")); AT.openView("animate"); }
        else AT.toast(t("vd.fail"));
        AT.renderDrawer();
      }, function (e) { AT.toast(errText(e)); });
    });
  }

  // ---------- session: clips in step with the film ----------
  // pages: page records in film order. o.audio: the elements'
  // sound goes to an AudioContext (video export) instead of the
  // speakers.
  function Session(doc, pages) {
    var vids = {}, snds = {}, all = [];
    var tl = Anim.timeline(doc, pages);
    var plan = CL.soundPlan(pages.map(function (p, i) {
      var bg = AX.background(doc, p.id), a = bg ? bg.ax : {};
      return { au: a.au, av: a.av, ao: a.ao, dur: tl.pages[i].dur };
    }));
    function make(src, muted) {
      var v = document.createElement("video");
      v.playsInline = true; v.preload = "auto"; v.muted = !!muted;
      v.src = src;
      all.push(v);
      return v;
    }
    function ready(v) {
      return new Promise(function (resolve) {
        if (v.readyState >= 2) { resolve(); return; }
        var timer = setTimeout(done, 8000);
        function done() { clearTimeout(timer); v.removeEventListener("loadeddata", done); v.removeEventListener("error", done); resolve(); }
        v.addEventListener("loadeddata", done);
        v.addEventListener("error", done);
      });
    }
    var pageOf = {};
    pages.forEach(function (p) { pageOf[p.id] = 1; });
    var jobs = [];
    doc.items.forEach(function (it) {
      if (!pageOf[it.pg] || !it.ax || !it.ax.vid || it.hide) return;
      jobs.push(url(it.ax.vid).then(function (u) {
        if (!u) return;
        var v = make(u, it.ax.mu);
        v.volume = (it.ax.vol === undefined ? 100 : it.ax.vol) / 100;
        vids[it.id] = { it: it, v: v };
        return ready(v);
      }));
    });
    plan.forEach(function (s) {
      if (!s || snds[s.id]) return;
      snds[s.id] = null;
      jobs.push(url(s.id).then(function (u) {
        if (!u) return;
        var v = snds[s.id] = make(u, false);
        return ready(v);
      }));
    });
    var stopped = false;
    function len(v) { return isFinite(v.duration) ? v.duration : 0; }
    function want(v, s, live) {
      if (live) {
        if (Math.abs(v.currentTime - s) > 0.35) v.currentTime = s;
        if (v.paused && !stopped) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        return null;
      }
      return seekTo(v, s);
    }
    function halt(v) { if (!v.paused) v.pause(); }

    // live: playing in real time (seek only when it drifts);
    // otherwise → a promise once every frame is in place (GIF)
    function sync(s, live) {
      var p = Anim.at(tl, s), cur = tl.pages[p.i], waits = [];
      Object.keys(vids).forEach(function (id) {
        var e = vids[id];
        if (e.it.pg !== cur.pg) { halt(e.v); return; }
        var w = CL.videoTime(e.it.ax, p.local, len(e.v));
        if (live && e.it.ax.nl && len(e.v) && w >= Math.min(len(e.v), e.it.ax.ve || len(e.v)) - 0.05) { halt(e.v); return; }
        var r = want(e.v, w, live);
        if (r) waits.push(r);
      });
      var sp = plan[p.i];
      Object.keys(snds).forEach(function (id) {
        var v = snds[id];
        if (!v) return;
        if (!live || !sp || sp.id !== id) { halt(v); return; }
        if (sndGain[id]) sndGain[id].gain.value = sp.vol / 100;
        else v.volume = sp.vol / 100;
        want(v, CL.soundTime(sp.from, p.local, len(v)), true);
      });
      return live ? null : Promise.all(waits);
    }
    var nodes = [], sndGain = {};
    return {
      timeline: tl,
      prepare: function () { return Promise.all(jobs); },
      empty: function () { return !Object.keys(vids).length && !Object.keys(snds).some(function (k) { return snds[k]; }); },
      hasVideo: function () { return Object.keys(vids).length > 0; },
      hasSound: function () {
        return Object.keys(vids).some(function (k) { return !vids[k].it.ax.mu; }) || Object.keys(snds).some(function (k) { return snds[k]; });
      },
      media: function (it) { var e = vids[it.id]; return e ? e.v : null; },
      sync: sync,
      // sound of the clips into an AudioContext node (video export)
      connect: function (ctx, dest) {
        Object.keys(vids).forEach(function (k) {
          var e = vids[k];
          if (e.it.ax.mu) return;
          var g = ctx.createGain(); g.gain.value = e.v.volume; e.v.volume = 1;
          ctx.createMediaElementSource(e.v).connect(g); g.connect(dest); nodes.push(g);
        });
        Object.keys(snds).forEach(function (k) {
          var v = snds[k];
          if (!v) return;
          var g = sndGain[k] = ctx.createGain();
          ctx.createMediaElementSource(v).connect(g); g.connect(dest); nodes.push(g);
        });
      },
      stop: function () {
        stopped = true;
        all.forEach(function (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {} });
        nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
      }
    };
  }

  // ---------- Video panel ----------
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
  function fmt(s) {
    s = Math.max(0, s || 0);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
  }
  var lens = {};
  function clipLen(id) {
    if (lens[id] !== undefined) return Promise.resolve(lens[id]);
    return url(id).then(function (u) {
      if (!u) return 0;
      return probe(u).then(function (v) { lens[id] = isFinite(v.duration) ? v.duration : 0; v.removeAttribute("src"); return lens[id]; }, function () { return 0; });
    });
  }
  function range(label, min, max, step, val, show, onInput) {
    var row = el("label", "rng-row");
    row.appendChild(el("span", "rng-l", label));
    var r = el("input", "rng");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = val;
    var v = el("span", "rng-v", show(val));
    r.addEventListener("input", function () { AT.beginGesture(); var n = Number(r.value); v.textContent = show(n); onInput(n); });
    r.addEventListener("change", function () { AT.endGesture(); });
    row.appendChild(r); row.appendChild(v);
    return row;
  }
  function check(label, on, fn) {
    var l = el("label", "chk-row");
    var c = el("input"); c.type = "checkbox"; c.checked = !!on;
    c.addEventListener("change", function () { fn(c.checked); });
    l.appendChild(c); l.appendChild(el("span", "", label));
    return l;
  }

  function videoView(body) {
    var one = ED.selItems().length === 1 ? ED.selItems()[0] : null;
    if (!one || !one.ax.vid) { body.appendChild(el("p", "hint", t("vd.pick"))); return; }
    var id = one.id, ax = one.ax, L = lens[ax.vid];
    if (L === undefined) {
      body.appendChild(el("p", "hint", t("vd.reading")));
      clipLen(ax.vid).then(function () { AT.renderDrawer(); });
      return;
    }
    function edit(fn) { AT.editItems([id], fn); }
    var s1 = sec(t("vd.trim"));
    if (!L) s1.appendChild(el("p", "hint", t("vd.missing")));
    else {
      var vs = ax.vs || 0, ve = ax.ve || L;
      s1.appendChild(range(t("vd.from"), 0, Math.max(0.1, L - 0.2), 0.1, vs, fmt, function (n) {
        edit(function (it) { if (n) it.ax.vs = n; else delete it.ax.vs; if (it.ax.ve && it.ax.ve <= n + 0.1) delete it.ax.ve; });
      }));
      s1.appendChild(range(t("vd.to"), 0.2, L, 0.1, ve, fmt, function (n) {
        edit(function (it) { if (n >= L - 0.05 || n <= (it.ax.vs || 0) + 0.1) delete it.ax.ve; else it.ax.ve = n; });
      }));
      s1.appendChild(el("p", "hint", t("vd.len", { s: fmt(L) })));
    }
    body.appendChild(s1);

    var s2 = sec(t("vd.sound"));
    s2.appendChild(check(t("vd.mute"), ax.mu, function (on) { edit(function (it) { if (on) it.ax.mu = 1; else delete it.ax.mu; }); AT.renderDrawer(); }));
    if (!ax.mu) s2.appendChild(range(t("vd.vol"), 0, 100, 5, ax.vol === undefined ? 100 : ax.vol, function (n) { return n + "%"; }, function (n) {
      edit(function (it) { if (n === 100) delete it.ax.vol; else it.ax.vol = n; });
    }));
    body.appendChild(s2);

    var s3 = sec(t("vd.playback"));
    s3.appendChild(check(t("vd.loop"), !ax.nl, function (on) { edit(function (it) { if (on) delete it.ax.nl; else it.ax.nl = 1; }); }));
    if (L) {
      var span = Math.max(1, Math.min(Anim.DUR_MAX, Math.ceil((ax.ve || L) - (ax.vs || 0) - 0.05)));
      s3.appendChild(btn("btn small block", t("vd.fitPage", { s: span }), function () {
        var bg = AX.background(AT.doc, ED.pg);
        if (!bg) return;
        AT.editItems([bg.id], function (it) { if (span === Anim.DUR_DEF) delete it.ax.dur; else it.ax.dur = span; });
        AT.toast(t("vd.fitted", { s: span }));
      }));
    }
    s3.appendChild(btn("btn small primary block", t("an.play"), function () { AT.motion.play(); }));
    s3.appendChild(el("p", "hint", t("vd.hint")));
    body.appendChild(s3);
  }
  AT.registerView("video", videoView);

  // ---------- Page sound (in the Animate panel) ----------
  function pageSection(body, bg) {
    var s = sec(t("vd.pageSound"));
    var a = bg.ax;
    if (!a.au) {
      s.appendChild(el("p", "hint", t("vd.noSound")));
      s.appendChild(btn("btn small block", t("vd.addSound"), upload));
      body.appendChild(s);
      return;
    }
    function edit(fn) { AT.editItems([bg.id], fn); }
    s.appendChild(range(t("vd.vol"), 0, 100, 5, a.av === undefined ? 100 : a.av, function (n) { return n + "%"; }, function (n) {
      edit(function (it) { if (n === 100) delete it.ax.av; else it.ax.av = n; });
    }));
    var L = lens[a.au];
    if (L === undefined) clipLen(a.au).then(function (x) { if (x) AT.renderDrawer(); });
    else if (L) s.appendChild(range(t("vd.startAt"), 0, Math.max(0.1, L - 0.5), 0.5, a.ao || 0, fmt, function (n) {
      edit(function (it) { if (n) it.ax.ao = n; else delete it.ax.ao; });
    }));
    var row = el("div", "pn-row");
    row.appendChild(btn("btn small", t("vd.allPages"), function () {
      var ids = [];
      AT.M.pagesInOrder(AT.doc).forEach(function (p) { var b = AX.background(AT.doc, p.id); if (b && b.id !== bg.id) ids.push(b.id); });
      if (!ids.length) return;
      AT.editItems(ids, function (it) { it.ax.au = a.au; if (a.av !== undefined) it.ax.av = a.av; else delete it.ax.av; delete it.ax.ao; });
      AT.toast(t("vd.allDone"));
    }));
    row.appendChild(btn("btn small", t("vd.replace"), upload));
    row.appendChild(btn("btn small", t("vd.removeSound"), function () { edit(function (it) { delete it.ax.au; delete it.ax.av; delete it.ax.ao; }); AT.renderDrawer(); }));
    s.appendChild(row);
    s.appendChild(el("p", "hint", t("vd.soundHint")));
    body.appendChild(s);
  }

  AT.video = { upload: upload, importClip: importClip, url: url, blob: blob, put: put, Session: Session, pageSection: pageSection };
})();
