// ============================================================
// orOS Writer — assist.js: the Assistant's changes (AS-EDIT, wave
// WR1, v1.0.0)
// The Assistant's edit_in_app card hands Writer a list of commands
// (commands.js) once the user presses Apply:
//   __orosOpenAt("writer", { edit: { key, chat, docs: [doc ids], steps } })
// Writer checks the commands again (it never trusts the request),
// applies them to a copy of each document (commands.js work()) and
// saves the result as a new edit of that document (the text through
// Writer's own sanitizer; the clocks of the groups that changed are
// stamped, so it syncs like any other change), keeps what Undo needs
// on this device and leaves its report for the card in the shell
// (orosAssistAtt.rb[key], as AS-RB):
//   { ok, n, d, per: [{ name, n }], cut: 0, notes, tok } | { failed, why }
// Undo, from the card, the change history or this toast:
//   __orosOpenAt("writer", { editUndo: { key, tok } })
//   → { ok } | { failed, why: "gone" | "undone" | "changed" }
// Undo puts every document back only if none was changed since, so a
// late Undo never takes away newer work. Undo data: IndexedDB
// oros-writer-assist (store "undo"), this device only, 30 days, 50
// entries. Loaded on the first request (writer.js), with commands.js.
// ============================================================
(function () {
  "use strict";

  var H = window.WriterAssistHost, K = window.WriterCommands;
  if (!H || !K) return;
  var t = H.t;

  // ---------- undo data (this device) ----------
  var DB = "oros-writer-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
  // A document's fingerprint: equal only while nobody changed it.
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
    return "we-" + s;
  }

  // ---------- the report back to the Assistant ----------
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

  // The fields the commands change, by clock group (writer.js FM_FIELDS).
  var GROUPS = { c: ["html", "footnotes"], m: ["title", "author", "tags", "category", "lang"], p: ["pageSize", "margins", "header", "footer"] };
  var FIELDS = GROUPS.c.concat(GROUPS.m, GROUPS.p);
  function fieldsOf(d) {
    var o = {};
    FIELDS.forEach(function (k) { o[k] = d[k] === undefined ? null : JSON.parse(JSON.stringify(d[k])); });
    return o;
  }
  // What the fingerprint is taken of: the fields, the text as Writer's
  // sanitizer writes it (the editor writes it the same way when the
  // document is opened, so opening it is not a change).
  function stateOf(d) {
    var o = fieldsOf(d);
    o.html = H.sanitize(o.html || "");
    return JSON.stringify(o);
  }
  // Writes fields into a document, stamping the groups that changed.
  function write(d, f) {
    var gs = [];
    Object.keys(GROUPS).forEach(function (g) {
      var ch = false;
      GROUPS[g].forEach(function (k) {
        var v = f[k] === null || f[k] === undefined ? (k === "lang" ? "" : f[k]) : f[k];
        if (JSON.stringify(d[k]) !== JSON.stringify(v)) { d[k] = JSON.parse(JSON.stringify(v)); ch = true; }
      });
      if (ch) gs.push(g);
    });
    gs.forEach(function (g) { H.stampDoc(d, g); });
    return gs.length > 0;
  }
  function after(ids) {
    if (ids.indexOf(H.activeId()) >= 0) H.renderEditor();
    H.renderTabs();
    H.scheduleSave();
  }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = K.check(rq && rq.steps);
    H.flushSave();
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { var d = typeof id === "string" ? H.getDoc(id) : null; return d && !d.del; }).slice(0, 300) : [];
    if (!chk.ok || !ids.length || busy) {
      H.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    var notes = [], snaps = [], per = [], total = 0, err = null, done = [];
    ids.forEach(function (id) {
      try {
        var d = H.getDoc(id), w = K.work(d), k = 0, env = { notes: notes };
        chk.steps.forEach(function (st) { k += K.apply(w, st, env); });
        if (!k) return;
        var before = fieldsOf(d);
        w.html = H.sanitize(w.html);
        if (!write(d, w)) return;
        if (d.track) { if (notes.indexOf("untracked") < 0) notes.push("untracked"); }
        snaps.push({ id: id, before: before });
        done.push(id);
        per.push({ name: d.title || K.view({ docs: [d] }).docs[0].name || t("tab.untitled"), n: k });
        total += k;
      } catch (e) {
        err = e;
        try { console.error("[orOS] writer: the Assistant's change failed", e); } catch (x) {}
      }
    });
    if (done.length) after(done);
    // fingerprints once the editor has taken the new text
    snaps.forEach(function (s) { s.fp = fp(stateOf(H.getDoc(s.id))); });
    busy = false;
    var rec = snaps.length ? { tok: newTok(), at: Date.now(), docs: snaps } : null;
    (rec ? put(rec) : Promise.resolve()).then(function () {
      // the changed document opens, so the user sees what changed
      if (snaps.length === 1 && H.activeId() !== snaps[0].id && !document.querySelector("dialog[open]")) H.activateTab(snaps[0].id);
      var rep = err && !snaps.length ? { failed: 1, why: "error" }
        : { ok: 1, n: total, d: snaps.length, per: per.slice(0, 50), cut: 0, notes: notes.slice(), tok: rec ? rec.tok : "" };
      back(key, rep);
      var msg = !total ? t("as.done0") : snaps.length === 1 ? t("as.done1").replace("{n}", total) : t("as.done").replace("{n}", total).replace("{d}", snaps.length);
      if (rec) H.undoToast(msg, function () { undo({ tok: rec.tok }); });
      else H.toast(msg);
    });
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.docs)) { H.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { H.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      H.flushSave();
      var changed = rec.docs.some(function (s) { var d = H.getDoc(s.id); return !d || d.del || fp(stateOf(d)) !== s.fp; });
      if (changed) { H.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      rec.docs.forEach(function (s) { write(H.getDoc(s.id), s.before); });
      after(rec.docs.map(function (s) { return s.id; }));
      rec.st = "undone";
      rec.docs = rec.docs.map(function (s) { return { id: s.id }; });   // nothing left to undo: the copies go
      return put(rec).then(function () {
        H.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  window.WriterAssist = { edit: edit, undo: undo, fp: fp };
})();
