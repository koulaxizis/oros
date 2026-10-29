// ============================================================
// orOS Slides — assist.js: the Assistant's changes (AS-EDIT, wave
// SL1, v1.0.0)
// The Assistant's edit_in_app card hands Slides a list of commands
// (commands.js) once the user presses Apply:
//   __orosOpenAt("slides", { edit: { key, chat, docs: [deck ids], steps } })
// Slides checks the commands again (it never trusts the request),
// applies them to a copy of each presentation (commands.js part()) and
// writes the result back as new edits (SL.putDeck: fresh stamps, so it
// syncs like any other change; the open presentation gets one undo
// step), keeps what Undo needs on this device and leaves its report
// for the card in the shell (orosAssistAtt.rb[key], as AS-RB):
//   { ok, n, d, per: [{ name, n }], cut: 0, notes, tok } | { failed, why }
// Undo, from the card, the change history or this toast:
//   __orosOpenAt("slides", { editUndo: { key, tok } })
//   → { ok } | { failed, why: "gone" | "undone" | "changed" }
// Undo puts every presentation back (SL.putDeck with the state from
// before) only if none was changed since, so a late Undo never takes
// away newer work. Undo data: IndexedDB oros-slides-assist (store
// "undo"), this device only, 30 days, 50 entries.
// Loaded on the first request (app.js), with commands.js.
// ============================================================
(function () {
  "use strict";

  var SL = window.SL, C = window.OrosSlidesCore, K = window.SlidesCommands;
  if (!SL || !C || !K) return;
  var t = SL.t;

  // ---------- undo data (this device) ----------
  var DB = "oros-slides-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
  // A presentation's fingerprint: equal only while nobody changed it.
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
    return "se-" + s;
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
  function title(d) { return (d && d.t) || t("deck.untitled"); }
  // A presentation's store (commands.js part()) as SL.deckState JSON.
  function stateOf(w, id) {
    var items = [];
    var slides = C.deckSlides(w, id);
    slides.forEach(function (s) { items = items.concat(C.slideItems(w, s.id)); });
    return JSON.stringify({ deck: w.decks[id], slides: slides, items: items });
  }
  function hasDialog() { return !!document.querySelector("dialog[open]"); }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = K.check(rq && rq.steps), data = SL.data();
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && data.decks[id]; }).slice(0, 300) : [];
    if (!chk.ok || !ids.length || busy) {
      SL.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    SL.emit("flush");
    var notes = [], snaps = [], per = [], total = 0, err = null;
    ids.forEach(function (id) {
      try {
        var w = K.part(SL.data(), id), before = SL.deckState(id), k = 0, env = { now: SL.now(), newId: SL.newId, notes: notes };
        if (!w || before === null) return;
        chk.steps.forEach(function (st) { k += K.apply(w, id, st, env); });
        if (!k || !SL.putDeck(id, stateOf(w, id))) return;
        snaps.push({ id: id, before: before, fp: fp(SL.deckState(id)) });
        per.push({ name: title(SL.data().decks[id]), n: k });
        total += k;
      } catch (e) {
        err = e;
        try { console.error("[orOS] slides: the Assistant's change failed", e); } catch (x) {}
      }
    });
    busy = false;
    var rec = snaps.length ? { tok: newTok(), at: Date.now(), decks: snaps } : null;
    (rec ? put(rec) : Promise.resolve()).then(function () {
      // the changed presentation opens, so the user sees what changed
      if (snaps.length === 1 && SL.deck !== snaps[0].id && !hasDialog()) {
        if (SL.deck) SL.goHome();
        SL.openDeck(snaps[0].id);
      } else if (!SL.deck) SL.renderHome();
      var rep = err && !snaps.length ? { failed: 1, why: "error" }
        : { ok: 1, n: total, d: snaps.length, per: per.slice(0, 50), cut: 0, notes: notes.slice(), tok: rec ? rec.tok : "" };
      back(key, rep);
      var msg = !total ? t("as.done0") : snaps.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: snaps.length });
      if (rec) SL.toast(msg, t("btn.undo"), function () { undo({ tok: rec.tok }); });
      else SL.toast(msg);
    });
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.decks)) { SL.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { SL.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      SL.emit("flush");
      var changed = rec.decks.some(function (s) { var st = SL.deckState(s.id); return st === null || fp(st) !== s.fp; });
      if (changed) { SL.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      rec.decks.forEach(function (s) { SL.putDeck(s.id, s.before); });
      rec.st = "undone";
      rec.decks = rec.decks.map(function (s) { return { id: s.id }; });   // nothing left to undo: the copies go
      return put(rec).then(function () {
        if (!SL.deck) SL.renderHome();
        SL.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  SL.assist = { edit: edit, undo: undo, fp: fp };
})();
