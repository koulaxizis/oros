/* ============================================================
   orOS Studio — assist.js: the Assistant's changes (AS-EDIT,
   wave ST1, v1.0.0)
   The Assistant's edit_in_app card hands Studio a list of commands
   (commands.js) once the user presses Apply:
     __orosOpenAt("studio", { edit: { key, chat, docs: [project ids], steps } })
   Studio checks the commands again (it never trusts the request),
   applies them to a copy of each project (commands.js work(), apply(),
   with StudioCore's normalisers and newer stamps, as put() and
   remove() do) and merges the result into its data, so every changed
   track and clip is a new edit that syncs like any other; when the
   open project changes, the change is one step of the app's own Undo. It keeps what Undo needs on this device and leaves
   its report for the card in the shell (orosAssistAtt.rb[key], as
   AS-RB):
     { ok, n, d, per: [{ name, n }], cut: 0, notes, tok } | { failed, why }
   Undo, from the card, the change history or this notice:
     __orosOpenAt("studio", { editUndo: { key, tok } })
     → { ok } | { failed, why: "gone" | "undone" | "changed" }
   Undo brings every project back (commands.js restore(), Studio's own
   restore()) only if none of them was changed since, so a late Undo
   never takes away newer work. Undo data: IndexedDB oros-studio-assist
   (store "undo"), this device only, 30 days, 50 entries. Loaded on
   the first request (studio.js), with commands.js.
   ============================================================ */
(function () {
  "use strict";

  var H = window.StudioAssistHost, K = window.StudioCommands, C = window.StudioCore;
  if (!H || !K || !C) return;
  var t = H.t;

  /* ---------- undo data (this device) ---------- */
  var DB = "oros-studio-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
  function put(rec) {
    return tx("readwrite", function (st) { st.put(rec, rec.tok); }).then(prune, function () {});
  }
  function get(tok) { return tx("readonly", function (st) { return st.get(tok); }).catch(function () { return null; }); }
  function prune() {
    return tx("readonly", function (st) { return st.getAll(); }).then(function (list) {
      var now = Date.now();
      list = (list || []).sort(function (a, b) { return b.at - a.at; });
      var drop = list.filter(function (r, i) { return i >= KEEP_N || now - r.at > KEEP_MS; }).map(function (r) { return r.tok; });
      if (drop.length) return tx("readwrite", function (st) { drop.forEach(function (k) { st.delete(k); }); });
    }).catch(function () {});
  }
  /* what was written: equal only while nobody changed it */
  function fp(s) {
    var h = 0x811c9dc5;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length + ":" + (h >>> 0).toString(16);
  }
  function newTok() {
    var b = new Uint8Array(9), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 9; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
    return "st-" + s;
  }

  /* ---------- the report back to the Assistant ---------- */
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

  function projJson(id) { var d = H.data(); return C.find(d, "projects", id) ? JSON.stringify(K.snapshot(d, id)) : ""; }
  /* the projects a change wrote, as they are now */
  function stateOf(rec) { return JSON.stringify(rec.projects.map(function (x) { return projJson(x.id); })); }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = K.check(rq && rq.steps);
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && C.find(H.data(), "projects", id); }).slice(0, 300) : [];
    var held = busy || H.busy();
    if (!chk.ok || !ids.length || held) {
      H.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : held ? "busy" : "gone" });
      return;
    }
    busy = true;
    var notes = [], per = [], perIds = [], total = 0, err = null;
    var rec = { tok: newTok(), at: Date.now(), projects: [] }, next = H.data();
    try {
      var env = { notes: notes, now: Date.now(), newId: function (kind) { return C.newId(kind, Math.random); },
        trackName: function (n, inst) { return inst ? t("snd." + inst) : t("track.default", { n: n }); } };
      ids.forEach(function (id) {
        var w = K.work(next, id), k = 0, was = JSON.stringify(K.snapshot(next, id));
        chk.steps.forEach(function (s) { k += K.apply(w, s, env); });
        if (!k || JSON.stringify(K.snapshot(w.data, id)) === was) return;
        rec.projects.push({ id: id, before: JSON.parse(was) });
        next = C.mergeStudio(next, w.data);
        per.push({ name: C.find(next, "projects", id).name, n: k }); perIds.push(id); total += k;
      });
    } catch (e) {
      err = e;
      rec.projects = []; per = []; perIds = []; total = 0;
      try { console.error("[orOS] studio: the Assistant's change failed", e); } catch (x) {}
    }
    var changed = rec.projects.length > 0;
    if (changed) {
      H.set(next, perIds.indexOf(H.pid()) >= 0);
      rec.fp = fp(stateOf(rec));
    }
    busy = false;
    (changed ? put(rec) : Promise.resolve()).then(function () {
      /* the changed project opens, so the user sees what changed */
      if (perIds.length === 1 && perIds[0] !== H.pid() && !document.querySelector("dialog[open]")) H.open(perIds[0]);
      var rep = err && !changed ? { failed: 1, why: "error" }
        : { ok: 1, n: changed ? total : 0, d: changed ? per.length : 0, per: changed ? per.slice(0, 50) : [], cut: 0, notes: notes.slice(), tok: changed ? rec.tok : "" };
      back(key, rep);
      var msg = !changed ? t("as.done0") : per.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: per.length });
      if (changed) H.undoToast(msg, function () { undo({ tok: rec.tok }); });
      else H.toast(msg);
    });
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.projects)) { H.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { H.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      var lost = rec.projects.some(function (x) { return !C.find(H.data(), "projects", x.id); });
      if (lost || fp(stateOf(rec)) !== rec.fp) { H.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      var next = H.data(), now = Date.now(), open = false;
      rec.projects.forEach(function (x) {
        next = K.restore(next, x.id, x.before, now);
        if (x.id === H.pid()) open = true;
      });
      H.set(next, open);
      rec.st = "undone";
      rec.projects = [];   /* nothing left to undo: the copies go */
      return put(rec).then(function () {
        H.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  window.StudioAssist = { edit: edit, undo: undo, fp: fp };
})();
