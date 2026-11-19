// ============================================================
// orOS Layout — proassist.js: the device side of LY-PRO W1 commands
// (layout/pro.js is the pure part). assist.js calls
//   LY.pro.prepare(doc, steps, notes, ctl) → Promise<{ env: [per step] }>
// which reads the pictures of `images` (only inside Claude's folders,
// Settings › orOS Gate; a cloud-only orOS Drive file is read in
// memory, hash-checked, through orosVault.peek, never written back),
// stores them as the document's own assets, makes the bleed of
// `bleedfill` (layout/bleedfill.js) and the page pictures of `thumbs`
// (/internal/Layout/Proofs/<document>/<time>/page-NNN.png).
// It never writes, moves or deletes anything in Claude's folders.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M;
  var PRO = window.LayoutPro, C = window.LayoutCommands, S = window.LayoutRecipes;
  if (!PRO || !C) return;
  var A = window.orosDK.assets;
  var PROOF_DIR = "/internal/Layout/Proofs", TICK = null;
  var MAX_BYTES = 80 * 1024 * 1024;

  function shellWin() { try { return window.parent && window.parent !== window ? window.parent : window; } catch (e) { return window; } }
  function fs() { try { return shellWin().orosFS || window.orosFS || null; } catch (e) { return window.orosFS || null; } }
  function vault() { try { var V = shellWin().orosVault; return V && typeof V.peek === "function" ? V : null; } catch (e) { return null; } }
  // Claude's folders, as the gate keeps them (one list for the gate
  // and the Assistant)
  function folders() {
    var l = [];
    try { var g = shellWin().orosGate; l = g && typeof g.folders === "function" ? g.folders() : []; } catch (e) { l = []; }
    return (Array.isArray(l) ? l : []).map(PRO.normPath).filter(Boolean);
  }
  function cloudOnly(path) {
    var V = vault();
    try { return !!(V && V.isRemoteOnly && V.isRemoteOnly(path)); } catch (e) { return false; }
  }
  // LOCAL-1: the local-folder bridge (localroots.js in the shell)
  function local() { try { return shellWin().orosLocal || null; } catch (e) { return null; } }
  function isLocal(p) { return typeof p === "string" && /^local:/i.test(p.trim()); }
  function localWhy(e) { return e && /^(notAllowedRoot|badPath|bridgePaused|needsReconnect|notThere|notFile|notFolder|timeout)$/.test(e.why) ? e.why : "unreadable"; }
  function outOf(L) {
    var w = [];
    try { w = L && typeof L.names === "function" ? L.names().filter(function (r) { return r && r.mode === "w"; }) : []; } catch (e) { w = []; }
    return w.length === 1 ? "local:" + w[0].name + "/Proofs" : "";
  }
  function readBytes(path) {
    if (isLocal(path)) {
      var L = local();
      if (!L) return Promise.reject({ why: "noBridge", path: path });
      return L.read(path, "layout");
    }
    if (cloudOnly(path)) return vault().peek(path).then(function (b) { return new Blob([b]); });
    return Promise.resolve(fs().read(path)).then(function (b) { return b instanceof Blob ? b : new Blob([b]); });
  }
  // The pictures directly in a folder (on this device and cloud-only).
  function listPics(dir) {
    var out = {}, F = fs();
    return Promise.resolve(F.ls(dir)).then(function (l) { return l || []; }, function () { return []; }).then(function (list) {
      list.forEach(function (e) {
        var name = typeof e === "string" ? e : e && e.name;
        var isDir = e && typeof e === "object" && (e.dir || e.kind === "dir" || e.type === "dir");
        if (name && !isDir && PRO.PIC.test(name)) out[name] = dir + "/" + name;
      });
      var V = vault();
      try {
        (V && V.remoteOnly ? V.remoteOnly(dir) : []).forEach(function (e) {
          var rest = e.path.slice(dir.length + 1);
          if (rest && rest.indexOf("/") < 0 && PRO.PIC.test(rest)) out[rest] = e.path;
        });
      } catch (x) { void x; }
      return out;
    });
  }
  // A step's files in order → [path] | throws { why }
  function pathsOf(st) {
    var fl = folders();
    var anyLocal = isLocal(st.folder) || (st.paths || []).some(isLocal);
    if (anyLocal) return localPaths(st);
    if (!fl.length) return Promise.reject({ why: "noFolders" });
    if (st.folder) {
      var dir = PRO.normPath(st.folder), w = PRO.pathOk(dir, fl, true);
      if (w) return Promise.reject({ why: "outside", path: st.folder });
      return listPics(dir).then(function (map) {
        var names = Object.keys(map);
        names = st.sort === "name" ? names.sort() : PRO.natSort(names);
        if (!names.length) throw { why: "empty", path: st.folder };
        return names.map(function (n) { return map[n]; });
      });
    }
    var list = [];
    for (var i = 0; i < st.paths.length; i++) {
      var p = PRO.normPath(st.paths[i]);
      if (PRO.pathOk(p, fl, false)) return Promise.reject({ why: "outside", path: st.paths[i] });
      list.push(p);
    }
    if (st.sort === "natural") list = PRO.natSort(list.map(function (p) { return p.slice(p.lastIndexOf("/") + 1) + "\u0000" + p; })).map(function (x) { return x.split("\u0000")[1]; });
    else if (st.sort === "name") list.sort();
    return Promise.resolve(list);
  }
  // pictures from a local folder (or local paths): the bridge checks
  // every one against the owner's roots
  function localPaths(st) {
    var L = local();
    if (!L) return Promise.reject({ why: "noBridge" });
    if (st.folder) {
      if (!isLocal(st.folder)) return Promise.reject({ why: "outside", path: st.folder });
      return L.ls(st.folder, 1, "layout").then(function (rows) {
        var map = {};
        rows.forEach(function (e) { if (!e.dir && e.name.indexOf("/") < 0 && PRO.PIC.test(e.name)) map[e.name] = e.path; });
        var names = Object.keys(map);
        names = st.sort === "name" ? names.sort() : PRO.natSort(names);
        if (!names.length) throw { why: "empty", path: st.folder };
        return names.map(function (n) { return map[n]; });
      }, function (e) { throw { why: localWhy(e), path: st.folder }; });
    }
    var list = [];
    for (var i = 0; i < st.paths.length; i++) {
      if (!isLocal(st.paths[i])) return Promise.reject({ why: "outside", path: st.paths[i] });
      list.push(String(st.paths[i]).trim());
    }
    var base = function (p) { return p.replace(/\\/g, "/").slice(p.replace(/\\/g, "/").lastIndexOf("/") + 1); };
    if (st.sort === "natural") list = PRO.natSort(list.map(function (p) { return base(p) + "\u0000" + p; })).map(function (x) { return x.split("\u0000")[1]; });
    else if (st.sort === "name") list.sort();
    return Promise.resolve(list);
  }
  function importPath(path) {
    return readBytes(path).then(function (blob) {
      if (blob.size > MAX_BYTES) throw { why: "tooBig", path: path };
      var name = path.replace(/\\/g, "/").slice(path.replace(/\\/g, "/").lastIndexOf("/") + 1);
      return A.importFile(new File([blob], name, { type: blob.type || "" })).then(function (r) { return { a: r.id, iw: r.w, ih: r.h, nm: name, lc: isLocal(path) ? 1 : 0 }; });
    }, function (e) { throw { why: isLocal(path) ? localWhy(e) : "unreadable", path: path }; });
  }

  // ---------- bleed ----------
  function imageData(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0);
    return { w: w, h: h, data: cx.getImageData(0, 0, w, h).data };
  }
  function loadBleedFill() {
    return window.LayoutBleedFill ? Promise.resolve(window.LayoutBleedFill) : LY.io.script("bleedfill.js", "LayoutBleedFill");
  }
  function fillOne(it, mode) {
    var need = PRO.needPx(LY_DOC_FOR_FILL, it);
    if (!need) return Promise.resolve(null);
    return Promise.all([loadBleedFill(), A.load(it.a)]).then(function (r) {
      var BF = r[0], img = r[1];
      if (!img) throw { why: "noPicture" };
      var src = imageData(img);
      // the stored size may be smaller than the item's iw (old imports)
      var k = src.w / (it.iw || src.w);
      var px = { l: Math.round(need.l * k), t: Math.round(need.t * k), r: Math.round(need.r * k), b: Math.round(need.b * k) };
      var res = BF.extend(src, px, mode, hashSeed(it.a));
      var cv = document.createElement("canvas");
      cv.width = res.w; cv.height = res.h;
      cv.getContext("2d").putImageData(new ImageData(res.data, res.w, res.h), 0, 0);
      return new Promise(function (ok, no) { cv.toBlob(function (b) { if (b) ok(b); else no({ why: "encode" }); }, "image/jpeg", 0.95); }).then(function (blob) {
        return A.importFile(new File([blob], (it.nm || "picture").replace(/\.[a-z0-9]+$/i, "") + "-bleed.jpg", { type: "image/jpeg" }));
      }).then(function (st) {
        // need.o in points, the asset's own size (it may be scaled down)
        return { a: st.id, iw: st.w, ih: st.h, mode: mode, need: need };
      });
    });
  }
  var LY_DOC_FOR_FILL = null;
  function hashSeed(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---------- page pictures ----------
  function stampNow() {
    var d = new Date(), z = function (n) { return ("0" + n).slice(-2); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + "-" + z(d.getMinutes()) + "-" + z(d.getSeconds());
  }
  function safeName(s) { return String(s || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled"; }
  function mkdirs(F, path) {
    var segs = path.slice("/internal/".length).split("/"), cur = "/internal", chain = Promise.resolve();
    segs.forEach(function (s) { cur += "/" + s; var p = cur; chain = chain.then(function () { return Promise.resolve(F.mkdir(p)).then(null, function () {}); }); });
    return chain;
  }
  function thumbs(doc, st) {
    var F = fs();
    if (!F) return Promise.reject({ why: "noDisk" });
    var order = M.pagesInOrder(doc), test = S.pageTest(st.pages), want = {};
    order.forEach(function (p, i) { if (test(i + 1)) want[p.id] = 1; });
    var groups = (st.spreads && doc.setup.facing ? M.spreads(doc) : order.map(function (p) { return [p]; }))
      .map(function (g) { return g.filter(function (p) { return want[p.id]; }); }).filter(function (g) { return g.length; }).slice(0, 60);
    var L = LY.R.computeLayout(doc), scale = st.dpi / 72, dir = PROOF_DIR + "/" + safeName(doc.name) + "/" + stampNow(), saved = [];
    // pictures first, so every page draws them
    var pre = Promise.resolve();
    doc.items.forEach(function (it) { if (it.t === "img" && it.a) pre = pre.then(function () { if (TICK) TICK(); return A.load(it.a); }); });
    return pre.then(function () { return mkdirs(F, dir); }).then(function () {
      var chain = Promise.resolve();
      groups.forEach(function (g) {
        chain = chain.then(function () {
          if (TICK) TICK();
          // each page at its own size, side by side, tops aligned
          var sz = g.map(function (p) { var z = M.pageSize(doc, p); return { w: Math.round(z.w * scale), h: Math.round(z.h * scale) }; });
          var cv = document.createElement("canvas");
          cv.width = sz.reduce(function (a, z) { return a + z.w; }, 0); cv.height = Math.max.apply(null, sz.map(function (z) { return z.h; }));
          var cx = cv.getContext("2d");
          cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, cv.width, cv.height);
          var x0 = 0;
          g.forEach(function (p, k) {
            var pc = LY.R.renderPage(doc, p, L, scale, { getImage: A.get, background: "#fff" });
            cx.drawImage(pc, x0, 0, sz[k].w, sz[k].h);
            x0 += sz[k].w;
          });
          var nums = g.map(function (p) { return ("00" + (order.indexOf(p) + 1)).slice(-3); }).join("-");
          return new Promise(function (ok, no) { cv.toBlob(function (b) { if (b) ok(b); else no({ why: "encode" }); }, "image/png"); }).then(function (blob) {
            var path = dir + "/page-" + nums + ".png";
            return Promise.resolve(F.write(path, blob)).then(function () {
              saved.push(path);
              // LOCAL-1: also in a local write folder (new names only)
              // Chris 2026-11-18 (P0): with one local write folder open and no
              // out, the proofs go there too (<root>/Proofs), so Claude sees them
              var L = local(), out = st.out && isLocal(st.out) ? st.out : outOf(L);
              if (!out || !L) return;
              return L.write(out, safeName(doc.name) + " page-" + nums + ".png", blob, "thumbs").then(function (lp) { saved.push(lp); }, function (e) { throw { why: localWhy(e), path: out }; });
            });
          });
        });
      });
      return chain;
    }).then(function () { return saved; });
  }

  // ---------- the batch ----------
  // Runs the async parts in order on a scratch copy (so bleedfill sees
  // the pages images made), with ids fixed per step (env.idf), so that
  // applying the same envs to the real document gives the same result.
  function newBase() {
    var b = new Uint8Array(5), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 5; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(36)).slice(-2);
    return s.slice(0, 8);
  }
  function idfFor(base, i) {
    var k = 0;
    return function (prefix) { k++; return prefix + "-" + base + ("0" + i).slice(-2) + k.toString(36); };
  }
  // envs[i] = { base, i, pics?, fills? }; envOf(envs[i]) gives a fresh
  // id sequence each time, so every copy gets the same new ids.
  function envOf(e) { return e ? Object.assign({}, e, { idf: idfFor(e.base, e.i), prepared: 1 }) : {}; }
  function prepare(doc, steps, ctx, notes, ctl) {
    var base = newBase(), envs = steps.map(function (st, i) { return { base: base, i: i }; });
    var scratch = JSON.parse(JSON.stringify(doc)), saved = [];
    var chain = Promise.resolve(), now = LY.now();
    steps.forEach(function (st, i) {
      chain = chain.then(function () {
        if (ctl && ctl.signal && ctl.signal.aborted) return;
        if (ctl && ctl.tick) ctl.tick();
        var env = envs[i];
        if (st.op === "images") {
          if (ctl && ctl.tick) ctl.tick(st.folder || (st.paths || [])[0] || "");
          return pathsOf(st).then(function (paths) {
            var pics = [], c2 = Promise.resolve();
            paths.slice(0, 400).forEach(function (p) {
              c2 = c2.then(function () {
                if (ctl && ctl.signal && ctl.signal.aborted) return;
                if (ctl && ctl.tick) ctl.tick(p);
                return importPath(p).then(function (x) { pics.push(x); if (ctl && ctl.tick) ctl.tick(); });
              });
            });
            return c2.then(function () { env.pics = pics; });
          });
        }
        if (st.op === "bleedfill") {
          LY_DOC_FOR_FILL = scratch;
          var list = PRO.bleedTargets(scratch, S.pageTest(st.pages)), fills = {}, c3 = Promise.resolve();
          list.forEach(function (it) { c3 = c3.then(function () { if (ctl && ctl.tick) ctl.tick(); return fillOne(it, st.mode).then(function (f) { if (f) fills[it.id] = f; }); }); });
          return c3.then(function () { env.fills = fills; LY_DOC_FOR_FILL = null; }, function (e) { LY_DOC_FOR_FILL = null; throw e; });
        }
        if (st.op === "addfont") return addFont(st, notes, ctl || {}).then(function (e) { env.font = e; });
        if ((st.op === "defstyle" || st.op === "masterfield") && st.font && !PRO.fontFor(scratch, st.font)) {
          if (ctl && ctl.tick) ctl.tick(st.font);
          return lib().then(function (l) { return LY.F.match(st.font, l); }).then(function (e) {
            if (e) { env.fonts = {}; env.fonts[PRO.fontKey(st.font)] = e; }
          }, function () {});
        }
        if (st.op === "thumbs") {
          TICK = ctl && ctl.tick ? function () { ctl.tick(); } : null;
          return thumbs(scratch, st).then(function (list) { TICK = null; saved = saved.concat(list); }, function (e) { TICK = null; throw e; });
        }
      }).then(function () {
        // the scratch copy follows, so later steps see this one
        C.apply(scratch, st, Object.assign(envOf(envs[i]), { now: now, grey: ctx.grey || {}, notes: notes, docs: LY.data().docs, meta: metaFor(doc), fill: window.LY_AUTO ? window.LY_AUTO.fillFields : null }));
      });
    });
    return chain.then(function () { return { envs: envs, saved: saved }; });
  }

  // ---------- fonts (Chris 2026-11-18: "fonts_add") ----------
  // addfont: a Fontsource family (its files kept in the cache for
  // offline use) or a font file from a local folder (into the owner's
  // fonts, /internal/Fonts) goes into the owner's collection `collection`
  // (the synced "fonts" slice, so list_fonts shows it); the document
  // lists it in C.apply. → Promise of the entry, or null with a note.
  var libP = null;
  function lib() {
    if (!libP) libP = LY.F.library({ all: true }).then(null, function () { libP = null; return []; });
    return libP;
  }
  function intoCollection(e, name) {
    var CB = LY.fonts && LY.fonts.cols, F = LY.F;
    if (!CB) return false;
    var lang = LY.LANG || "en";
    CB.edit(function (d) {
      var r = F.cols.add(d, name || "Claude", Date.now(), Math.random(), lang);
      if (!r.id) return d;
      return F.cols.set(r.d, r.id, { id: e.id, name: e.name, fb: e.fb }, 1, Date.now());
    });
    return true;
  }
  var VAR_NAME = { r: "regular", b: "bold", i: "italic", bi: "bold italic" };
  function addFont(st, notes, ctl) {
    var F = LY.F, col = st.collection || "Claude";
    function said(e, extra) { notes.push("fontAdded: " + e.name + " in the collection " + col + (extra ? ", " + extra : "")); }
    if (st.source === "local") {
      var name = String(st.path).replace(/\\/g, "/").split("/").pop();
      if (ctl.tick) ctl.tick(st.path);
      return readBytes(st.path).then(function (blob) {
        if (ctl.tick) ctl.tick();
        return F.importFile(new File([blob], name, { type: blob.type || "font/ttf" }));
      }, function (e) { throw { why: localWhy(e), path: st.path }; }).then(function (r) {
        if (!r || r.err) { notes.push("fontBad: " + name + " is not a font file orOS can use (" + ((r && r.err) || "type") + ")"); return null; }
        libP = null;
        return lib().then(function (l) {
          var k = PRO.fontKey(r.family), fam = F.families(l).filter(function (f) { return PRO.fontKey(f.name) === k; })[0];
          if (!fam) { notes.push("fontBad: " + name); return null; }
          intoCollection(fam, col);
          said(fam, "styles " + ["r", "b", "i", "bi"].filter(function (v) { return fam[v]; }).map(function (v) { return VAR_NAME[v]; }).join(", "));
          return fam;
        });
      });
    }
    if (ctl.tick) ctl.tick(st.family);
    return F.catalog().then(function (cat) {
      if (!cat.length) { notes.push("fontsOffline: the Fontsource list could not be read (offline?)"); return null; }
      var k = PRO.fontKey(st.family), id = F.fsIdOf(st.family);
      var c = cat.filter(function (x) { return x.id === id; })[0] || cat.filter(function (x) { return PRO.fontKey(x.family) === k; })[0];
      if (!c) { notes.push("noFont: " + String(st.family).slice(0, 60) + " is not a Fontsource family (names as fontsource.org shows them)"); return null; }
      var want = C.fontVars(st.styles), have = c.vars || [], vars = want.length ? want.filter(function (v) { return have.indexOf(v) >= 0; }) : have.slice();
      if (want.length > vars.length) notes.push("fontStyles: " + c.family + " has only " + have.map(function (v) { return VAR_NAME[v]; }).join(", "));
      var e = { id: c.id, name: c.family, fb: c.cat };
      return F.cols.keepOffline([{ id: c.id, vars: vars.length ? vars : ["r"] }], function () { if (ctl.tick) ctl.tick(); }).then(function (res) {
        if (res && res.failed) notes.push("fontFiles: " + res.failed + " files of " + c.family + " could not be fetched now; they load when the device is online");
        intoCollection(e, col);
        said(e, "Greek " + (c.greek ? "full" : "none") + ", polytonic " + (c.poly ? "full" : "none") + ", licence " + (c.lic || "open"));
        return e;
      });
    });
  }

  // The book's details for house_pages: the Publishing app's title of
  // the document's name (read only, as houseui.js pubTitles).
  function metaFor(doc) {
    var data = null, name = String((doc && doc.name) || "").trim().toLocaleLowerCase(), out = { title: (doc && doc.name) || "" };
    try { data = JSON.parse(localStorage.getItem("oros-publish-data") || "null"); } catch (e) { data = null; }
    var tombs = (data && data.tombs) || {};
    var x = ((data && data.titles) || []).filter(function (x) { return x && x.id && x.t && !(tombs[x.id] >= x.m) && String(x.t).trim().toLocaleLowerCase() === name; })[0];
    if (!x) return out;
    out.title = String(x.t); out.subtitle = String(x.sub || "");
    out.author = (x.ppl || []).filter(function (p) { return p && p.r === "a" && p.n; }).map(function (p) { return p.n; }).join(", ");
    (x.fmts || []).some(function (f) { if (f && f.isbn) { out.isbn = String(f.isbn); return true; } return false; });
    if (/^\d{4}/.test(x.rel || "")) out.year = x.rel.slice(0, 4);
    return out;
  }

  LY.pro = { metaFor: metaFor, prepare: prepare, envOf: envOf, thumbs: thumbs, folders: folders, PROOF_DIR: PROOF_DIR };
})();
