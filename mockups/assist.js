/* ============================================================
   orOS Mockups — assist.js: the Assistant's and Claude's changes
   (MK-G, v1.0.0)
   Chris 2026-11-22: add Mockups to the Gate. The edit_in_app
   card (or the Gate) hands Mockups a list of commands (commands.js):
     __orosOpenAt("mockups", { edit: { key, chat, docs: [ids], steps } })
   Mockups checks them again (it never trusts the request), copies the
   pictures they name from Claude's folders into the mockup's pictures
   (designkit/assets.js, as when the owner picks one), applies the
   commands to each project and saves it, so it syncs like any other
   change. create (designs new) makes a new book mockup first. export
   makes the picture as Save does, into Pictures, and into `out` (a
   local write folder or a folder of Claude's) through the gate. It
   leaves its report for the card in the shell (orosAssistAtt.rb[key]):
     { ok, n, d, per: [{ name, n }], cut: 0, made, files, notes, tok, saved?, outFail? } | { failed, why }
   Undo, from the card, the change history or this notice:
     __orosOpenAt("mockups", { editUndo: { key, tok } })
   brings every changed mockup back only if none was changed since; a
   mockup it made stays (deleting is the owner's). Undo data: IndexedDB
   oros-mockups-assist (store "undo"), this device only, 30 days, 50.
   ============================================================ */
(function () {
  "use strict";

  var H = window.MockupsAssistHost, K = window.MockupsCommands, C = window.MockCore;
  if (!H || !K || !C) return;
  var t = H.t;

  /* ---------- undo data (this device) ---------- */
  var DB = "oros-mockups-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
        var tr = d.transaction("undo", mode), st = tr.objectStore("undo"), out = fn(st);
        tr.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        tr.onerror = tr.onabort = function () { reject(tr.error); };
      });
    });
  }
  function put(rec) { return tx("readwrite", function (st) { st.put(rec, rec.tok); }).then(prune, function () {}); }
  function get(tok) { return tx("readonly", function (st) { return st.get(tok); }).catch(function () { return null; }); }
  function prune() {
    return tx("readonly", function (st) { return st.getAll(); }).then(function (list) {
      var now = Date.now();
      list = (list || []).sort(function (a, b) { return b.at - a.at; });
      var drop = list.filter(function (r, i) { return i >= KEEP_N || now - r.at > KEEP_MS; }).map(function (r) { return r.tok; });
      if (drop.length) return tx("readwrite", function (st) { drop.forEach(function (k) { st.delete(k); }); });
    }).catch(function () {});
  }
  function newTok() {
    var b = new Uint8Array(9), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 9; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
    return "mk-" + s;
  }
  function back(key, rep) {
    if (typeof key !== "string" || !key) return;
    try {
      var st = window.parent && window.parent !== window ? window.parent.orosAssistAtt : null;
      if (!st) return;
      if (!st.rb) st.rb = {};
      st.rb[key.slice(0, 80)] = rep;
      if (typeof st.onRb === "function") st.onRb(key);
    } catch (e) {}
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { a = clone(a); b = clone(b); a.m = b.m = 0; return C.canon(a) === C.canon(b); }
  function gate() { try { var g = window.parent && window.parent !== window ? window.parent.orosGate : null; return g && typeof g.exportAll === "function" ? g : null; } catch (e) { return null; } }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = K.check(rq && rq.steps);
    var fresh = chk.ok && chk.steps[0].op === "create";
    var ids = fresh ? [] : rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && H.find(id); }).slice(0, 200) : [];
    var held = busy || H.busy();
    if (!chk.ok || (!fresh && !ids.length) || held) {
      H.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : held ? "busy" : "gone" });
      return;
    }
    busy = true;
    var notes = [], per = [], total = 0, made = 0, files = 0, saved = [], outFail = [];
    var rec = { tok: newTok(), at: Date.now(), docs: [] }, assets = {}, impNoPic = 0;
    // 1. the pictures, copied from Claude's folders
    var paths = K.picPaths(chk.steps), chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return H.importPath(p).then(function (id) { assets[p] = id; }, function (e) {
          var k = e && e.why === "outside" ? "picOutside" : e && e.why === "nofile" ? "picMissing" : "noPicture";
          if (k === "noPicture") impNoPic = 1;
          if (notes.indexOf(k) < 0) notes.push(k);
        });
      });
    });
    var env = { notes: notes, asset: function (p) { return assets[p] || ""; } };
    chain.then(function () {
      // 2. a new mockup first (create)
      if (fresh) {
        var nid = H.create(chk.steps[0].title || "");
        if (!nid) throw new Error("full");
        ids = [nid]; made = 1;
      }
      // 3. the changes, each mockup saved once
      ids.forEach(function (id) {
        var p = H.find(id), before = clone(p), k = 0;
        chk.steps.forEach(function (s) { if (K.CATALOG[s.op].kind === "doc") k += K.apply(p, s, env); });
        if (!k || same(p, before)) return;
        var m = H.save(p);
        if (!m) return;
        if (!fresh) rec.docs.push({ id: id, before: before, m: m });
        per.push({ name: p.nm || t("untitled"), n: k });
        total += k;
      });
      // 4. the pictures (export), as Save makes them
      var outs = chk.steps.filter(function (s) { return s.op === "export"; }), ex = Promise.resolve();
      ids.forEach(function (id) {
        outs.forEach(function (s) {
          ex = ex.then(function () {
            var p = H.find(id);
            K.apply(p, s, env);
            if (!same(p, H.find(id))) H.save(p);
            return H.exportAs(id, s.fmt).then(function (f) {
              if (!f) { outFail.push({ to: s.out || "Pictures", why: "error" }); return; }
              files++;
              return H.toPictures(f.blob, f.name).then(function (path) {
                if (path) saved.push(path);
                if (!s.out) return;
                var G = gate();
                if (!G) { outFail.push({ to: s.out, why: "gateOff" }); return; }
                return Promise.resolve(G.exportAll([s.out], [f], "export")).then(function (r) {
                  saved = saved.concat(r && r.saved || []); outFail = outFail.concat(r && r.outFail || []);
                });
              });
            }).then(null, function () { outFail.push({ to: s.out || "Pictures", why: "error" }); });
          });
        });
      });
      return ex;
    }).then(function () { return rec.docs.length ? put(rec) : null; }).then(function () { return null; }, function (e) { return e; }).then(function (err) {
      busy = false;
      if (ids.length === 1) H.open(ids[0]);
      var rep = err && !per.length && !made ? { failed: 1, why: String(err && err.message) === "full" ? "full" : "error" }
        : { ok: 1, n: total, d: per.length, per: per.slice(0, 50), cut: 0, made: made, files: files, notes: notes.slice(), tok: rec.docs.length ? rec.tok : "" };
      // a picture the copy already named (outside, missing) is not named twice
      if (rep.ok && !impNoPic && (notes.indexOf("picOutside") >= 0 || notes.indexOf("picMissing") >= 0)) rep.notes = rep.notes.filter(function (x) { return x !== "noPicture"; });
      if (rep.ok && saved.length) rep.saved = saved.slice(0, 60);
      if (rep.ok && outFail.length) rep.outFail = outFail.slice(0, 4);
      back(key, rep);
      var msg = made ? t("as.made", { name: per.length ? per[0].name : t("untitled") }) : !total ? (files ? t("as.files", { n: files }) : t("as.done0"))
        : per.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: per.length });
      if (rec.docs.length) H.undoToast(msg, function () { undo({ tok: rec.tok }); });
      else H.toast(msg);
    });
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.docs) || rec.st === "undone") { H.toast(t("as.gone")); back(key, { failed: 1, why: rec ? "undone" : "gone" }); return; }
      var lost = rec.docs.some(function (x) { var p = H.find(x.id); return !p || p.m !== x.m; });
      if (lost) { H.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      rec.docs.forEach(function (x) { H.save(x.before); });
      rec.st = "undone";
      rec.docs = [];
      return put(rec).then(function () { H.toast(t("as.undone")); back(key, { ok: 1 }); });
    });
  }

  window.MockupsAssist = { edit: edit, undo: undo };
})();
