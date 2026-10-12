// ============================================================
// orOS Photo Lab — app core (v1.0.0)
// A layered image editor in the spirit of Photoshop, GIMP,
// Photopea and Paint.NET. This file holds the shared state (PL),
// i18n, toasts, the document lifecycle (new, open, save, close),
// undo plumbing, the synced project index, the palette and the
// boot. view.js draws, tools.js handles the pointer, panels.js the
// panels, menus and dialogs, io.js files in and out, jobs.js the
// worker.
// Data:
//   - synced slice "photolab" (oros-photolab-data): the project
//     index only (core.js mergeIndex: LWW per project + tombstones)
//   - projects = files on the orOS disk, synced by Vault Drive
//     (photolab/store.js): /internal/Photo Lab/<id>/…
//   - device-local (R10): oros-photolab-prefs (tool options,
//     colours, panels)
// Deep link: __orosOpenAt("photolab", { id }) opens a project;
// { openFile: { token } } opens a device file handed over by the
// shell (BR-FILE-OPEN); { openFile: "/internal/…" } opens a picture
// already on the orOS disk (e.g. a frame grabbed in Montage).
// ============================================================
(function () {
  "use strict";

  var NS = window.PhotoLab;
  var PL = window.PL = {
    C: NS.core, T: NS.tiles, H: NS.history, S: NS.select, P: NS.paint,
    R: NS.resample, A: NS.adjust, ST: NS.store, PSD: NS.psd, ORA: NS.ora,
    FX: window.orosDK && window.orosDK.fx
  };
  var C = PL.C, T = PL.T, H = PL.H;
  var STORAGE_KEY = "oros-photolab-data";
  var PREFS_KEY = "oros-photolab-prefs";
  var SAVE_MS = 1500;

  // ---------- i18n ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  PL.LANG = appLang();
  PL.t = function (key, params) {
    var S = window.PL_STRINGS, p = S[PL.LANG] || S.en;
    var s = p[key] !== undefined ? p[key] : (S.en[key] !== undefined ? S.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  };
  PL.num = function (n) { try { return n.toLocaleString(PL.LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return String(n); } };

  // ---------- DOM helpers ----------
  PL.$ = function (id) { return document.getElementById(id); };
  PL.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  PL.setLabel = function (b, label) { b.setAttribute("aria-label", label); b.title = label; };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = PL.LANG;
    console.log("photolab app.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- Events ----------
  var subs = {};
  PL.on = function (name, fn) { (subs[name] || (subs[name] = [])).push(fn); };
  PL.emit = function (name, arg) { (subs[name] || []).forEach(function (fn) { fn(arg); }); };

  // ---------- State ----------
  var phone = (function () {
    try { return window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820; }
    catch (e) { return false; }
  })();
  PL.phone = phone;
  PL.limits = C.limitsFor(phone);
  var st = PL.st = {
    doc: null, surfaces: {}, active: null, sel: null,
    hist: H.create(phone ? H.PHONE_BUDGET : H.DESKTOP_BUDGET),
    fg: "#000000", bg: "#ffffff", tool: "brush",
    dirty: false, fresh: false, saving: false, known: {}, missing: 0
  };
  var index = C.emptyIndex();
  PL.index = function () { return index; };

  PL.layer = function () {
    var d = st.doc;
    if (!d) return null;
    var i = C.findLayer(d, st.active);
    return i >= 0 ? d.layers[i] : (d.layers[d.layers.length - 1] || null);
  };
  PL.surface = function (id) { return st.surfaces[id] || (st.surfaces[id] = T.create()); };
  PL.selectLayer = function (id) { st.active = id; PL.emit("layers"); };

  // ---------- Prefs (device-local) ----------
  function dflt() {
    return {
      tool: "brush", fg: "#000000", bg: "#ffffff", panel: "layers", panelOpen: !phone,
      brush: { size: 20, hard: 80, opacity: 100, flow: 100, lockAlpha: false },
      eraser: { size: 30, hard: 80, opacity: 100, flow: 100 },
      fill: { tol: 32, contiguous: true, opacity: 100, all: false },
      wand: { tol: 32, contiguous: true, all: false },
      gradient: { type: "linear", opacity: 100, toClear: false },
      shape: { id: "rect", noFill: false, stroke: false, sw: 8 },
      selMode: "replace", feather: 0, marqueeEllipse: false, lassoPoly: false, cropRatio: "free",
      exportFmt: "png", exportQ: 90, recent: []
    };
  }
  function mergePrefs(base, p) {
    Object.keys(base).forEach(function (k) {
      if (!(k in p)) return;
      var b = base[k], v = p[k];
      if (b && typeof b === "object" && !Array.isArray(b)) { if (v && typeof v === "object") mergePrefs(b, v); }
      else if (typeof b === typeof v && (!Array.isArray(b) || Array.isArray(v))) base[k] = v;
    });
    return base;
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    PL.prefs = mergePrefs(dflt(), p && typeof p === "object" ? p : {});
    var P = PL.prefs;
    ["brush", "eraser"].forEach(function (k) {
      P[k].size = Math.max(1, Math.min(2000, Math.round(P[k].size) || 20));
      ["hard", "opacity", "flow"].forEach(function (f) { P[k][f] = Math.max(1, Math.min(100, Math.round(P[k][f]) || 100)); });
    });
    if (!/^#[0-9a-f]{6}$/i.test(P.fg)) P.fg = "#000000";
    if (!/^#[0-9a-f]{6}$/i.test(P.bg)) P.bg = "#ffffff";
    if (["replace", "add", "sub", "and"].indexOf(P.selMode) < 0) P.selMode = "replace";
    st.fg = P.fg; st.bg = P.bg;
    st.tool = PL.tools.ORDER.indexOf(P.tool) >= 0 ? P.tool : "brush";
  }
  var prefsTimer = null;
  PL.savePrefs = function () {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(function () {
      PL.prefs.fg = st.fg; PL.prefs.bg = st.bg; PL.prefs.tool = st.tool === "transform" ? "move" : st.tool;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(PL.prefs)); } catch (e) {}
    }, 300);
  };
  PL.on("colors", PL.savePrefs);

  // ---------- Toasts ----------
  PL.toast = function (text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "photolab", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  };
  PL.undoToast = function (text, onUndo) { localToast(text, onUndo, PL.t("btn.undo")); };
  PL.actionToast = function (text, label, fn) { localToast(text, fn, label); };
  var toastTimer = null;
  function localToast(text, onUndo, label) {
    var box = PL.$("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(PL.el("span", "", text));
    if (onUndo) {
      var b = PL.el("button", "", label);
      b.type = "button";
      b.addEventListener("click", function () { box.classList.remove("show"); clearTimeout(toastTimer); onUndo(); });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }
  PL.live = function (msg) {
    var n = PL.$("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  };
  var busyN = 0;
  PL.busy = function (on) {
    busyN = Math.max(0, busyN + (on ? 1 : -1));
    var b = PL.$("busy");
    if (b) b.hidden = !busyN;
  };

  // ---------- Disk ----------
  PL.fs = function () {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  };

  // ---------- Undo plumbing ----------
  PL.pushStep = function (step) {
    st.hist.push(step);
    if (st.hist.dropped()) PL.toast(PL.t("msg.histDropped"));
    PL.emit("history");
  };
  // The document record (layers, size, names) from a JSON copy.
  PL.setDocRecord = function (rec) {
    var keep = st.doc ? st.doc.id : rec.id;
    rec.id = keep;
    // Tile names describe the surfaces, which an undo of a layer-list
    // change does not touch: keep the current names (a stale copy
    // would point the saved doc at old pixels).
    if (st.doc) rec.layers.forEach(function (L) {
      var i = C.findLayer(st.doc, L.id);
      if (L.k === "raster" && i >= 0 && st.doc.layers[i].k === "raster") L.t = st.doc.layers[i].t;
    });
    st.doc = rec;
    if (C.findLayer(rec, st.active) < 0) st.active = rec.layers.length ? rec.layers[rec.layers.length - 1].id : null;
    if (st.sel && (st.sel.w !== rec.w || st.sel.h !== rec.h)) { st.sel = null; PL.view.selChanged(); }
    PL.view.invalidate();
    PL.emit("layers");
    PL.emit("doc");
  };
  function markAllDirty(L, s) {
    Object.keys(L.t || {}).forEach(function (k) { s.dirty[k] = 1; });
    s.tiles.forEach(function (t, k) { s.dirty[k] = 1; });
  }
  // A change to the document record and (optionally) the pixels of
  // some layers, as ONE undo step. ids: layer ids whose pixels fn may
  // change, or "all". fn may add or delete layers.
  PL.docChange = function (label, fn, ids) {
    var d = st.doc;
    var before = JSON.stringify(d), selBefore = st.sel;
    function pick() {
      if (ids === "all") return st.doc.layers.filter(function (L) { return L.k === "raster"; }).map(function (L) { return L.id; });
      return ids || [];
    }
    var idsBefore = pick(), snapB = {};
    idsBefore.forEach(function (id) { snapB[id] = T.clone(PL.surface(id)); });
    fn();
    var after = JSON.stringify(st.doc), selAfter = st.sel;
    var idsAfter = pick(), snapA = {};
    idsAfter.forEach(function (id) { snapA[id] = st.surfaces[id] ? T.clone(st.surfaces[id]) : T.create(); });
    var bytes = 0;
    [snapB, snapA].forEach(function (m) { Object.keys(m).forEach(function (k) { bytes += m[k].tiles.size * T.TILE * T.TILE * 4; }); });
    function put(snap, all, rec) {
      Object.keys(snap).forEach(function (id) {
        var s = T.clone(snap[id]);
        st.surfaces[id] = s;
        var i = C.findLayer(rec, id);
        if (i >= 0) markAllDirty(rec.layers[i], s);
        PL.view.dropLayer(id);
      });
      all.forEach(function (id) { if (!(id in snap)) { delete st.surfaces[id]; PL.view.dropLayer(id); } });
    }
    var union = idsBefore.concat(idsAfter.filter(function (i) { return idsBefore.indexOf(i) < 0; }));
    PL.pushStep({
      label: label,
      bytes: bytes + (before.length + after.length) * 2 + (selBefore && selBefore !== selAfter ? selBefore.data.length * 2 : 0),
      undo: function () {
        var rec = JSON.parse(before);
        put(snapB, union, rec);
        PL.setDocRecord(rec);
        if (st.sel !== selBefore) { st.sel = selBefore; PL.view.selChanged(); }
        PL.changed();
      },
      redo: function () {
        var rec = JSON.parse(after);
        put(snapA, union, rec);
        PL.setDocRecord(rec);
        if (st.sel !== selAfter) { st.sel = selAfter; PL.view.selChanged(); }
        PL.changed();
      }
    });
    idsAfter.forEach(function (id) {
      var i = C.findLayer(st.doc, id);
      if (i >= 0 && st.surfaces[id]) markAllDirty(st.doc.layers[i], st.surfaces[id]);
      PL.view.dropLayer(id);
    });
    PL.view.invalidate();
    PL.emit("layers");
    PL.emit("doc");
    PL.changed();
  };
  PL.setSel = function (mask, label) {
    if (mask && PL.S.isEmpty(mask)) mask = null;
    var before = st.sel;
    if (!before && !mask) return;
    st.sel = mask;
    PL.view.selChanged();
    PL.pushStep({
      label: label, bytes: (before ? before.data.length : 0) + (mask ? mask.data.length : 0),
      undo: function () { st.sel = before; PL.view.selChanged(); PL.emit("sel"); },
      redo: function () { st.sel = mask; PL.view.selChanged(); PL.emit("sel"); }
    });
    PL.emit("sel");
  };
  PL.undo = function () {
    if (PL.tools.busy()) return;
    if (PL.tools.transforming()) { PL.tools.endTransform(false); return; }
    var l = st.hist.undo();
    if (l) { PL.live(PL.t("live.undo", { s: l })); PL.emit("history"); }
  };
  PL.redo = function () {
    if (PL.tools.busy()) return;
    var l = st.hist.redo();
    if (l) { PL.live(PL.t("live.redo", { s: l })); PL.emit("history"); }
  };

  // ---------- Layers ----------
  PL.addLayer = function (raw, label, below) {
    var L = C.normLayer(Object.assign({ id: C.newLayerId(), vis: 1, op: 100, bl: "normal" }, raw));
    if (!L) return null;
    if (st.doc.layers.length >= C.MAX_LAYERS) { PL.toast(PL.t("msg.maxLayers")); return null; }
    PL.docChange(label, function () {
      var i = C.findLayer(st.doc, st.active);
      var at = i < 0 ? st.doc.layers.length : (below ? i : i + 1);
      st.doc.layers.splice(at, 0, L);
      st.active = L.id;
      if (raw.surface) st.surfaces[L.id] = raw.surface;
    }, raw.surface ? [L.id] : []);
    return L;
  };
  PL.shapeName = function (id) {
    var list = PL.FX.SHAPES;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i][PL.LANG] || list[i].en;
    return PL.t("layer.shape");
  };
  // Crop the canvas to r (doc px). Layers keep their pixels outside
  // the new canvas (like Photoshop with "Delete cropped pixels" off).
  PL.cropTo = function (r, label) {
    PL.docChange(label, function () {
      st.doc.w = r.w; st.doc.h = r.h;
      st.doc.layers.forEach(function (L) { L.x -= r.x; L.y -= r.y; });
      st.sel = null; PL.view.selChanged();
    }, []);
  };

  // ---------- Saving ----------
  var saveTimer = null;
  PL.changed = function () {
    if (!st.doc) return;
    st.doc.m = Math.max(Date.now(), (index.tombs[st.doc.id] || 0) + 1, st.doc.m + 1);    // R27
    st.dirty = true; st.fresh = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(PL.saveNow, SAVE_MS);
    PL.emit("dirty");
  };
  var thumbAt = 0;
  PL.saveNow = function () {
    clearTimeout(saveTimer); saveTimer = null;
    var fs = PL.fs();
    if (!st.doc || !st.dirty) return Promise.resolve(true);
    if (!fs) { PL.emit("dirty"); return Promise.resolve(false); }
    if (st.saving) { saveTimer = setTimeout(PL.saveNow, 400); return Promise.resolve(false); }
    st.saving = true; st.dirty = false;
    var doc = st.doc;
    return PL.ST.save(fs, C, T, doc, st.surfaces, st.known).then(function (r) {
      st.saving = false;
      // store.save() wrote the tile names into the open record itself.
      setIndex(C.upsertEntry(index, r.doc), true);
      if (Date.now() - thumbAt > 8000 || !st.dirty) { thumbAt = Date.now(); PL.io.saveThumb(); }
      PL.emit("dirty");
      if (st.dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(PL.saveNow, SAVE_MS); }
      return true;
    }, function (e) {
      st.saving = false; st.dirty = true;
      PL.toast(PL.t(e && /quota|space|full/i.test(String(e.message || e.name)) ? "msg.diskFull" : "msg.saveFail"));
      PL.emit("dirty");
      return false;
    });
  };

  // ---------- Projects ----------
  function resetDoc(doc, surfaces) {
    st.doc = doc; st.surfaces = surfaces || {};
    st.active = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
    st.sel = null; st.hist.clear(); st.dirty = false; st.missing = 0;
    PL.view.resetCaches(); PL.view.selChanged();
  }
  PL.showEditor = function () {
    document.body.classList.add("editing");
    PL.view.resize(); PL.view.fit();
    PL.tools.enter(st.tool);
    PL.emit("layers"); PL.emit("history"); PL.emit("doc"); PL.emit("tool"); PL.emit("dirty");
  };
  // A new project; fill: "white" | "clear" | "fg". Written to the disk
  // on its first change (R28: lazy, no empty projects).
  PL.newProject = function (w, h, name, fill) {
    var fit = C.fitSize(w, h, PL.limits);
    if (fit.scaled) PL.toast(PL.t("msg.scaled", { w: fit.w, h: fit.h }));
    var doc = C.newDoc({ w: fit.w, h: fit.h, name: name || PL.t("doc.untitled"), now: Date.now(), layerName: PL.t("layer.bg") });
    var surfaces = {};
    var s = surfaces[doc.layers[0].id] = T.create();
    if (fill !== "clear") {
      var c = PL.P.rgbOf(fill === "fg" ? st.fg : "#ffffff").concat(255);
      solidFill(s, fit.w, fit.h, c);
    }
    resetDoc(doc, surfaces);
    st.fresh = true;
    PL.showEditor();
    return doc;
  };
  function solidFill(s, w, h, c) {
    T.keysIn(0, 0, w, h).forEach(function (k) {
      var i = k.indexOf(","), tx = +k.slice(0, i), ty = +k.slice(i + 1), t = T.ensure(s, tx, ty);
      var x1 = Math.min(T.TILE, w - tx * T.TILE), y1 = Math.min(T.TILE, h - ty * T.TILE);
      for (var y = 0; y < y1; y++) for (var x = 0; x < x1; x++) t.set(c, (y * T.TILE + x) * 4);
      s.dirty[k] = 1;
    });
  }
  // A project from a decoded picture { w, h, data }.
  PL.newFromImage = function (img, name) {
    var doc = C.newDoc({ w: img.w, h: img.h, name: name, now: Date.now(), layerName: PL.t("layer.bg") });
    var s = T.create();
    T.writeRect(s, 0, 0, img);
    var surfaces = {}; surfaces[doc.layers[0].id] = s;
    resetDoc(doc, surfaces);
    PL.showEditor();
    PL.changed();
  };
  // A project from a layered file (PSD, OpenRaster): layers bottom →
  // top, each { name, x, y, img, op, bl, vis }, already within limits.
  PL.newFromLayers = function (w, h, name, layers) {
    var doc = C.newDoc({ w: w, h: h, name: name, now: Date.now(), layerName: PL.t("layer.bg") });
    var surfaces = {};
    doc.layers = [];
    layers.forEach(function (src) {
      var L = C.normLayer({ id: C.newLayerId(), k: "raster", name: src.name, x: src.x, y: src.y,
                            op: src.op, bl: src.bl, vis: src.vis });
      var s = T.create();
      T.writeRect(s, 0, 0, src.img);
      surfaces[L.id] = s;
      doc.layers.push(L);
    });
    resetDoc(doc, surfaces);
    PL.showEditor();
    PL.changed();
  };
  PL.openProject = function (id) {
    var fs = PL.fs();
    if (!fs) { PL.toast(PL.t("msg.noDisk")); return Promise.resolve(false); }
    return PL.closeProject(true).then(function () {
      PL.busy(true);
      return splitConflicts(fs, id).then(function () {
        return PL.ST.load(fs, C, T, id, st.known);
      });
    }).then(function (r) {
      PL.busy(false);
      resetDoc(r.doc, r.surfaces);
      st.missing = r.missing;
      if (r.missing) PL.toast(PL.t("msg.missingTiles"));
      PL.showEditor();
      return true;
    }, function () {
      PL.busy(false);
      PL.toast(PL.t("msg.openFail"));
      return false;
    });
  };
  // Vault Drive keeps another device's version as a conflict copy:
  // each one becomes its own project, never lost (store.splitConflict).
  function splitConflicts(fs, id) {
    return PL.ST.conflicts(fs, id).then(function (files) {
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          return PL.ST.splitConflict(fs, C, id, f, C.newProjectId(), PL.t("doc.otherDevice"), Date.now()).then(function (doc) {
            setIndex(C.upsertEntry(index, doc), true);
            PL.toast(PL.t("msg.conflictKept", { name: doc.name }));
          }, function () {});
        });
      });
      return chain;
    }, function () {});
  }
  PL.closeProject = function (quiet) {
    if (!st.doc) return Promise.resolve(true);
    PL.tools.cancel();
    if (PL.tools.transforming()) PL.tools.endTransform(true);
    return PL.saveNow().then(function () {
      if (!quiet) { st.doc = null; st.surfaces = {}; st.sel = null; st.hist.clear(); document.body.classList.remove("editing"); PL.home.render(); }
      return true;
    });
  };
  PL.renameDoc = function (name) {
    name = C.cleanName(name);
    if (!name || !st.doc || name === st.doc.name) return;
    PL.docChange(PL.t("step.rename"), function () { st.doc.name = name; }, []);
  };
  PL.deleteProject = function (id) {
    var entry = null;
    index.projects.forEach(function (e) { if (e.id === id) entry = e; });
    if (!entry) return;
    var keep = JSON.parse(JSON.stringify(entry)), undone = false;
    setIndex(C.removeEntry(index, id, Date.now()), true);
    PL.home.render();
    PL.undoToast(PL.t("msg.deleted", { name: entry.name }), function () {
      undone = true;
      keep.m = Math.max(Date.now(), (index.tombs[id] || 0) + 1);
      setIndex(C.mergeIndex(index, { projects: [keep] }), true);
      PL.home.render();
    });
    setTimeout(function () {
      if (undone) return;
      var fs = PL.fs();
      if (fs) PL.ST.remove(fs, id);
    }, 9000);
  };
  PL.renameProject = function (id, name) {
    name = C.cleanName(name);
    if (!name) return;
    var fs = PL.fs();
    if (!fs) return;
    PL.ST.load(fs, C, T, id, st.known).then(function (r) {
      r.doc.name = name;
      r.doc.m = Math.max(Date.now(), r.doc.m + 1);
      return fs.write(PL.ST.dirOf(id) + "/doc.json", JSON.stringify(r.doc)).then(function () {
        setIndex(C.upsertEntry(index, r.doc), true);
        PL.home.render();
      });
    }).catch(function () { PL.toast(PL.t("msg.saveFail")); });
  };

  // ---------- Index storage + sync slice ----------
  function loadIndex() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try { index = C.normIndex(JSON.parse(raw)); return; } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    }
    index = C.emptyIndex();
  }
  var saveFailShown = false;
  function setIndex(next, mine) {
    index = next;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(index)); saveFailShown = false; }
    catch (e) { if (!saveFailShown) { saveFailShown = true; PL.toast(PL.t("msg.saveFail")); } }    // R30
    if (mine && window.__orosSyncApi) window.__orosSyncApi.dirty();
    PL.emit("index");
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () { if (!this._suppress && api && typeof api.markDirty === "function") api.markDirty(); }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("photolab", sliceGet, sliceSet, STORAGE_KEY, C.mergeIndex);
  }
  function sliceGet() { return C.mergeIndex(index, index); }        // canonical (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    var before = JSON.stringify(index);
    window.__orosSyncApi._suppress = true;                           // R6
    try { setIndex(C.normIndex(incoming), false); } finally { window.__orosSyncApi._suppress = false; }
    if (JSON.stringify(index) === before) return;
    if (st.doc && !st.fresh) {
      var e = null;
      index.projects.forEach(function (x) { if (x.id === st.doc.id) e = x; });
      if (e && e.m > st.doc.m && !st.dirty) PL.home.offerReload();
    }
    if (!st.doc) PL.home.render();
  }

  // ---------- Palette (inheritPalette + watchPalette) ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
    if (PL.view) PL.view.themeChanged();
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- Deep link ----------
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.id === "string" && C.ID_RE.test(target.id)) { PL.openProject(target.id); return; }
    var f = target.openFile;
    if (f && typeof f === "object" && typeof f.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(f.token); } catch (e) {}
      if (file) PL.io.openPictureFile(file, false);
      else PL.toast(PL.t("msg.openFail"));
      return;
    }
    if (typeof f === "string") PL.io.openDiskPath(f);
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- Boot ----------
  PL.boot = function () {
    loadIndex();
    loadPrefs();
    inheritPalette();
    PL.panels.build();
    PL.view.attach(PL.$("cv"));
    PL.tools.wire(PL.$("cv"));
    registerSync();
    watchPalette();
    PL.home.render();
    window.addEventListener("resize", function () { PL.view.resize(); });
    window.addEventListener("pagehide", function () { PL.saveNow(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") PL.saveNow(); });
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("photolab");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  };
})();
