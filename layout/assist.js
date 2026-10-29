// ============================================================
// orOS Layout — assist.js: the Assistant's changes (AS-EDIT for
// Layout, v1.0.0)
// The Assistant's edit_in_app card hands Layout a list of commands
// (commands.js) once the user presses Apply:
//   __orosOpenAt("layout", { edit: { key, chat, docs: [ids], steps } })
// Layout checks the commands again (it never trusts the request),
// makes the black and white copies a grey command needs (recipes.js),
// applies them (the open document through LY.op, so it keeps an undo
// step; the others through LY.putDoc), keeps what Undo needs on this
// device and leaves its report for the card in the shell
// (orosAssistAtt.rb[key], as AS-RB):
//   { ok, n, d, per: [{ name, n }], cut: 0, notes, tok } | { failed, why }
// Undo, from the card, the change history or this toast:
//   __orosOpenAt("layout", { editUndo: { key, tok } })
//   → { ok } | { failed, why: "gone" | "undone" | "changed" }
// Undo puts every document back (LY.restoreDoc, as new edits) only if
// none was changed since the Assistant changed it, so a late Undo
// never takes away newer work. Undo data: IndexedDB oros-layout-assist
// (store "undo"), this device only, 30 days, 50 entries.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, M = LY.M, t = LY.t;
  var C = window.LayoutCommands;
  if (!C) return;

  // ---------- undo data (this device) ----------
  var DB = "oros-layout-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
  function fp(doc) {
    var s = JSON.stringify(doc), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length + ":" + (h >>> 0).toString(16);
  }
  function newTok() {
    var b = new Uint8Array(9), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 9; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
    return "le-" + s;
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
  function title(d) { return d.name || t("doc.untitled"); }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = C.check(rq && rq.steps);
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && LY.findDoc(id); }).slice(0, 500) : [];
    if (!chk.ok || !ids.length || busy) {
      LY.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    LY.flushStory && LY.flushStory();
    var steps = chk.steps, notes = [], snaps = [], per = [], total = 0;
    var ctl = { signal: { aborted: false } };
    function oneDoc(id) {
      var cur = LY.findDoc(id);
      if (!cur) return Promise.resolve();
      return LY.recipeGrey(cur, steps.filter(function (s) { return s.op !== "rename"; }), ctl).then(function (ctx) {
        cur = LY.findDoc(id);   // it may have changed while the copies were made
        if (!cur) return;
        var before = JSON.parse(JSON.stringify(cur)), work = JSON.parse(JSON.stringify(cur)), nw = LY.now(), k = 0;
        steps.forEach(function (st) { k += C.apply(work, st, { now: nw, grey: ctx.grey, notes: notes }); });
        if (!k) return;
        var done = cur === LY.doc
          ? LY.op(function (w, now) { var n = 0; steps.forEach(function (st) { n += C.apply(w, st, { now: now, grey: ctx.grey }); }); return n ? undefined : false; })
          : LY.putDoc(work);
        if (!done) return;
        var now2 = LY.findDoc(id);
        snaps.push({ id: id, before: before, fp: fp(now2) });
        per.push({ name: title(now2), n: k });
        total += k;
      });
    }
    var chain = Promise.resolve();
    ids.forEach(function (id) { chain = chain.then(function () { return oneDoc(id); }); });
    chain.then(function () { return finish(null); }, function (e) {
      try { console.error("[orOS] layout: the Assistant's change failed", e); } catch (x) {}
      return finish(e);
    });
    function finish(err) {
      busy = false;
      var rec = snaps.length ? { tok: newTok(), at: Date.now(), docs: snaps } : null;
      return (rec ? put(rec) : Promise.resolve()).then(function () {
        // the changed document opens, so the user sees what changed
        if (snaps.length === 1 && (!LY.doc || LY.doc.id !== snaps[0].id) && !document.querySelector("dialog[open]")) {
          if (LY.doc) LY.goHome();
          LY.openDoc(snaps[0].id);
        } else if (!LY.doc) LY.renderHome();
        var rep = err && !snaps.length ? { failed: 1, why: "error" }
          : { ok: 1, n: total, d: snaps.length, per: per.slice(0, 50), cut: 0, notes: notes.slice(), tok: rec ? rec.tok : "" };
        back(key, rep);
        var msg = !total ? t("as.done0") : snaps.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: snaps.length });
        if (rec) LY.toast(msg, t("btn.undo"), function () { undo({ tok: rec.tok }); });
        else LY.toast(msg);
      });
    }
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.docs)) { LY.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { LY.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      LY.flushStory && LY.flushStory();
      var changed = rec.docs.some(function (s) { var d = LY.findDoc(s.id); return !d || fp(d) !== s.fp; });
      if (changed) { LY.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      rec.docs.forEach(function (s) { LY.restoreDoc(s.before); });
      rec.st = "undone";
      rec.docs = rec.docs.map(function (s) { return { id: s.id }; });   // nothing left to undo: the copies go
      return put(rec).then(function () {
        if (!LY.doc) LY.renderHome();
        LY.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  LY.assist = { edit: edit, undo: undo, fp: fp };
})();
