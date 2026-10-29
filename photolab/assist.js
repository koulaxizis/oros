// ============================================================
// orOS Photo Lab — assist.js: the Assistant's changes (AS-EDIT, wave
// PL1, v1.0.0)
// The Assistant's edit_in_app card hands Photo Lab a list of commands
// (commands.js) once the user presses Apply:
//   __orosOpenAt("photolab", { edit: { key, chat, docs: [ids], steps } })
// Photo Lab checks the commands again (it never trusts the request)
// and applies them in the editor, one project after the other: each
// project opens, every command runs as the editor's own command (one
// undo step there), and the project is saved. It keeps what Undo
// needs on this device and leaves its report for the card in the
// shell (orosAssistAtt.rb[key], as AS-RB):
//   { ok, n, d, per: [{ name, n }], cut: 0, made: 0, files, notes, tok } | { failed, why }
// export saves the picture into Pictures (files).
// Undo, from the card, the change history or this toast:
//   __orosOpenAt("photolab", { editUndo: { key, tok } })
//   → { ok } | { failed, why: "gone" | "undone" | "changed" }
// Undo writes every project's doc.json back as it was (its tiles are
// never rewritten and never removed, store.js), only if no project
// was changed since (doc.m) and every tile it names is still on the
// disk, so a late Undo never takes away newer work. Undo data:
// IndexedDB oros-photolab-assist (store "undo"), this device only,
// 30 days, 50 entries.
// ============================================================
(function () {
  "use strict";

  var PL = window.PL, st = PL.st, C = window.PhotoLabCommands, RS = window.PhotoLabRecipes;
  if (!C || !RS) return;
  var CORE = PL.C;
  function t(k, p) { return PL.t(k, p); }
  // an undo step's name: the automation step's name, else "Assistant"
  function label(op) { var k = "rc.op." + op, s = t(k); return s === k ? t("as.step") : s; }

  // ---------- undo data (this device) ----------
  var DB = "oros-photolab-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
  var dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var rq;
        try { rq = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
        rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains("undo")) rq.result.createObjectStore("undo"); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tr = d.transaction("undo", mode), s = tr.objectStore("undo"), out = fn(s);
        tr.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        tr.onerror = tr.onabort = function () { reject(tr.error); };
      });
    });
  }
  function put(rec) { return tx("readwrite", function (s) { s.put(rec, rec.tok); }).then(prune, function () {}); }
  function get(tok) { return tx("readonly", function (s) { return s.get(tok); }).catch(function () { return null; }); }
  function prune() {
    return tx("readonly", function (s) { return s.getAll(); }).then(function (list) {
      var now = Date.now();
      list = (list || []).sort(function (a, b) { return b.at - a.at; });
      var drop = list.filter(function (r, i) { return i >= KEEP_N || now - r.at > KEEP_MS; }).map(function (r) { return r.tok; });
      if (drop.length) return tx("readwrite", function (s) { drop.forEach(function (k) { s.delete(k); }); });
    }).catch(function () {});
  }
  function newTok() {
    var b = new Uint8Array(9), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 9; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
    return "pe-" + s;
  }

  // ---------- the report back to the Assistant ----------
  function back(key, rep) {
    if (typeof key !== "string" || !key) return;
    try {
      var sh = window.parent && window.parent !== window ? window.parent.orosAssistAtt : null;
      if (!sh) return;
      if (!sh.rb) sh.rb = {};
      sh.rb[key.slice(0, 80)] = rep;
      if (typeof sh.onRb === "function") sh.onRb(key);
    } catch (e) {}
  }

  // ---------- the commands in the editor ----------
  function measure(tx) {
    var c = document.createElement("canvas").getContext("2d"), F = PL.view.FONTS;
    c.font = (tx.i ? "italic " : "") + (tx.b ? "bold " : "") + tx.z + "px " + (F[tx.f] || F.sans);
    var lines = String(tx.s || "").split("\n"), w = 1;
    lines.forEach(function (l) { w = Math.max(w, Math.ceil(c.measureText(l).width)); });
    var pad = Math.ceil(tx.z * 0.25);
    return { w: w + pad * 2, h: Math.max(1, Math.round(tx.z * tx.lh / 100) * lines.length) + pad * 2 };
  }
  function env(notes) {
    return {
      notes: notes, newLayerId: function () { return CORE.newLayerId(); }, measure: measure, normFx: CORE.normFx,
      adjName: function (id) { return t("adjk." + id); }, shapeName: PL.shapeName
    };
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  // One command on the open project → Promise<how many changed>.
  function runStep(s, notes) {
    var d = st.doc, kind = C.CATALOG[s.op].kind, k = C.apply(copy(d), s, env(notes));
    if (!k) return Promise.resolve(0);
    if (kind === "doc") {
      var owners = s.op === "remove" ? CORE.tileOwners(d).map(function (o) { return o.id; }) : [];
      var n = 0;
      PL.docChange(label(s.op), function () {
        n = C.apply(st.doc, s, env(notes));
        st.doc.layers = st.doc.layers.map(function (L) { return CORE.normLayer(L) || L; });
      }, owners);
      return Promise.resolve(n);
    }
    if (kind === "size") {
      var p;
      if (s.op === "crop") { var r = C.cropRect(d.w, d.h, s); PL.cropTo(r, label("crop")); }
      else if (s.op === "canvas") PL.ops.canvasSize(Math.round(s.w), Math.round(s.h), s.pos);
      else if (s.op === "resize") { var z = C.resizeTo(d.w, d.h, s); p = PL.ops.resizeImage(z.w, z.h); }
      else if (s.op === "rotate") p = PL.ops.rotateAny(s.deg);
      else if (s.op === "flip") p = PL.ops.flipImage(s.dir === "h");
      return Promise.resolve(p).then(function () { return k; });
    }
    if (s.op === "watermark") { PL.recipes.watermark(s); return Promise.resolve(1); }
    // pixels (and dup): each picked layer in turn, the whole layer
    var list = C.pick(d, s).map(function (L) { return L.id; }), done = 0, chain = Promise.resolve();
    var j = s.op === "dup" ? null : RS.job(s);
    list.forEach(function (id) {
      chain = chain.then(function () {
        if (CORE.findLayer(st.doc, id) < 0) return;
        PL.selectLayer(id, false);
        if (s.op === "dup") { PL.ops.duplicate(); done++; return; }
        var tg = j.kind === "adjust" ? PL.ops.adjustTarget() : PL.ops.filterTarget();
        if (!tg) return;
        return (j.kind === "adjust" ? PL.ops.applyAdjust(tg, j.id, j.p, label(s.op)) : PL.ops.applyFilter(tg, j.id, j.p, label(s.op))).then(function () { done++; });
      });
    });
    return chain.then(function () { return done; });
  }
  function exportPic(s) {
    return PL.io.render(s.fmt, s.quality / 100, 1).then(function (blob) {
      if (!blob) return null;
      var ext = s.fmt === "webp" && blob.type !== "image/webp" ? "png" : s.fmt;
      return PL.io.saveToPictures(blob, PL.io.fileName(ext));
    });
  }

  // A small progress dialog with Stop.
  function progress(text, onStop) {
    var d = PL.el("dialog", "dlg"), f = PL.el("div", "dlg-form"), p = PL.el("p", "hint", text), a = PL.el("div", "dlg-actions"), b = PL.el("button", "btn", t("as.stop"));
    b.type = "button";
    f.appendChild(PL.el("h2", "dlg-title", t("app.name")));
    f.appendChild(p);
    a.appendChild(b);
    f.appendChild(a);
    d.appendChild(f);
    document.body.appendChild(d);
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    b.addEventListener("click", function () { onStop(); close(); });
    d.addEventListener("cancel", function (e) { e.preventDefault(); onStop(); close(); });
    d.showModal();
    return { set: function (s) { p.textContent = s; }, close: close };
  }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = C.check(rq && rq.steps), known = {};
    PL.index().projects.forEach(function (e) { known[e.id] = e; });
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && known[id]; }).slice(0, 500) : [];
    if (!chk.ok || !ids.length || busy || !PL.fs()) {
      PL.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    PL.tools.cancel();
    if (PL.tools.transforming()) PL.tools.endTransform(true);
    var steps = chk.steps, notes = [], snaps = [], per = [], total = 0, files = 0, stopped = false;
    var first = st.doc ? st.doc.id : "";
    var dlg = progress(ids.length > 1 ? t("as.working", { n: ids.length }) : t("as.working1"), function () { stopped = true; });
    var chain = Promise.resolve();
    ids.forEach(function (id, i) {
      chain = chain.then(function () {
        if (stopped) return;
        if (ids.length > 1) dlg.set(t("as.doing", { i: i + 1, n: ids.length, name: known[id].name }));
        var open = st.doc && st.doc.id === id ? PL.saveNow() : PL.openProject(id);
        return open.then(function (ok) {
          if (ok === false || !st.doc || st.doc.id !== id) { if (notes.indexOf("openFail") < 0) notes.push("openFail"); return; }
          return PL.saveNow().then(function () {
            var before = copy(st.doc), k = 0, c2 = Promise.resolve();
            if (st.sel) { st.sel = null; PL.view.selChanged(); }
            steps.forEach(function (s) {
              c2 = c2.then(function () {
                if (stopped) return;
                if (C.CATALOG[s.op].kind === "out") return exportPic(s).then(function (p) { if (p) files++; });
                return runStep(s, notes).then(function (n) { k += n; });
              });
            });
            return c2.then(function () { return PL.saveNow(); }).then(function () {
              if (!k) return;
              snaps.push({ id: id, before: before, m: st.doc.m });
              per.push({ name: st.doc.name, n: k });
              total += k;
            });
          });
        });
      });
    });
    chain.then(function () { return finish(null); }, function (e) {
      try { console.error("[orOS] photolab: the Assistant's change failed", e); } catch (x) {}
      return finish(e);
    });
    function finish(err) {
      busy = false;
      dlg.close();
      var rec = snaps.length ? { tok: newTok(), at: Date.now(), docs: snaps } : null;
      return (rec ? put(rec) : Promise.resolve()).then(function () {
        // the picture that was open comes back; one changed picture stays open
        var show = snaps.length === 1 ? snaps[0].id : first;
        var p = show && (!st.doc || st.doc.id !== show) ? PL.openProject(show) : !show && ids.length > 1 ? PL.closeProject(false) : Promise.resolve();
        return p.then(function () {
          var rep = err && !rec ? { failed: 1, why: "error" }
            : { ok: 1, n: total, d: snaps.length, per: per.slice(0, 50), cut: 0, made: 0, files: files, notes: notes.slice(), tok: rec ? rec.tok : "" };
          if (stopped) rep.stopped = 1;
          back(key, rep);
          var msg = stopped ? t("as.stopped") : !total ? (files ? t("as.files", { n: files }) : t("as.done0"))
            : (snaps.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: snaps.length })) + (files ? " " + t("as.files", { n: files }) : "");
          if (rec) PL.undoToast(msg, function () { undo({ tok: rec.tok }); });
          else PL.toast(msg);
        });
      });
    }
  }

  // ---------- Undo ----------
  function readDisk(fs, id) {
    return fs.read(PL.ST.dirOf(id) + "/doc.json").then(function (b) { return b && typeof b.text === "function" ? b.text() : String(b || ""); })
      .then(function (s) { return CORE.normDoc(JSON.parse(s)); }).catch(function () { return null; });
  }
  function tilesThere(fs, doc) {
    var ok = true, chain = Promise.resolve();
    CORE.tilesOf(doc).forEach(function (n) {
      chain = chain.then(function () { if (ok) return fs.stat(PL.ST.tilePath(doc.id, n)).catch(function () { ok = false; }); });
    });
    return chain.then(function () { return ok; });
  }
  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "", fs = PL.fs();
    function no(why, msg) { PL.toast(t(msg)); back(key, { failed: 1, why: why }); }
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.docs) || !fs) return no("gone", "as.gone");
      if (rec.st === "undone") return no("undone", "as.gone");
      if (busy) return no("busy", "as.bad");
      var first = st.doc ? st.doc.id : "";
      return PL.saveNow().then(function () {
        var now = {}, why = "";
        var c = Promise.resolve();
        rec.docs.forEach(function (s) {
          c = c.then(function () {
            if (why) return;
            return readDisk(fs, s.id).then(function (d) {
              if (!d || d.m !== s.m) { why = "changed"; return; }
              now[s.id] = d;
              return tilesThere(fs, s.before).then(function (ok) { if (!ok) why = "gone"; });
            });
          });
        });
        return c.then(function () {
          if (why) return no(why, why === "gone" ? "as.gone" : "as.changed");
          var w = Promise.resolve();
          rec.docs.forEach(function (s) {
            w = w.then(function () {
              var d = CORE.normDoc(s.before);
              d.m = Math.max(Date.now(), now[s.id].m + 1);
              return fs.write(PL.ST.dirOf(s.id) + "/doc.json", JSON.stringify(d)).then(function () {
                PL.putIndex(d);
                // the thumbnail follows: the project opens once
                return PL.openProject(s.id).then(function () { if (st.doc && st.doc.id === s.id) return PL.io.saveThumb(); });
              });
            });
          });
          return w.then(function () {
            rec.st = "undone";
            rec.docs = rec.docs.map(function (s) { return { id: s.id }; });
            return put(rec);
          }).then(function () {
            if (first && (!st.doc || st.doc.id !== first)) return PL.openProject(first);
            if (!first) return PL.closeProject(false);
          }).then(function () {
            PL.toast(t("as.undone"));
            back(key, { ok: 1 });
          });
        });
      });
    });
  }

  PL.assist = { edit: edit, undo: undo };
})();
