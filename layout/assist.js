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

  // busy: the run now (Chris 2026-11-18: name the command that holds
  // Layout, and let it be stopped): { ops, since, ctl, stop }
  // Pages the commands added or removed, and where (Chris 2026-11-18:
  // flow and fit say how many pages they added, so left and right stay
  // under control): "pages: 10 → 14, new pp. 7-10 (p. 7 right, p. 10 left)".
  function pagesNote(before, after, notes) {
    var o0 = M.pagesInOrder(before), o1 = M.pagesInOrder(after);
    if (o0.length === o1.length && o0.every(function (p, i) { return o1[i].id === p.id; })) return;
    var had = {};
    o0.forEach(function (p) { had[p.id] = 1; });
    var nw = [];
    o1.forEach(function (p, i) { if (!had[p.id]) nw.push(i); });
    var side = function (i) { var sd = M.sideOf(after, i); return sd === "L" ? "left" : sd === "R" ? "right" : ""; };
    var runs = [];
    nw.forEach(function (i) { var r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); });
    var txt = "pages: " + o0.length + " → " + o1.length;
    if (runs.length) txt += ", new " + runs.slice(0, 12).map(function (r) {
      return r[0] === r[1] ? "p. " + (r[0] + 1) + (side(r[0]) ? " " + side(r[0]) : "") : "pp. " + (r[0] + 1) + "-" + (r[1] + 1) + (side(r[0]) ? " (p. " + (r[0] + 1) + " " + side(r[0]) + ", p. " + (r[1] + 1) + " " + side(r[1]) + ")" : "");
    }).join(", ");
    var gone = o0.length + nw.length - o1.length;
    if (gone > 0) txt += ", " + gone + " removed";
    if (notes.length < 40) notes.push(txt);
  }
  var busy = false, WATCH_MS = 60000, run = null;
  function holder() {
    if (!run) return null;
    return { ops: run.ops.slice(0, 8), since: run.since, at: run.ctl.at ? String(run.ctl.at).slice(0, 200) : "", idle: Math.round((Date.now() - run.ctl.last) / 1000) };
  }
  // Stops the run now: nothing more is changed, what it changed so far stays (with Undo).
  function stopRun(by) { if (run && run.stop) run.stop(by); }
  var PRO_ASYNC = { images: 1, bleedfill: 1, thumbs: 1, addfont: 1, placepage: 1 };
  // defstyle with a font Layout must look up (the disk, Fontsource)
  function slowStep(st) { return PRO_ASYNC[st.op] || ((st.op === "defstyle" || st.op === "masterfield") && st.font && window.LayoutPro && !window.LayoutPro.fontFor({ setup: {} }, st.font)); }
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = C.check(rq && rq.steps);
    // cancel (alone): stops the run that holds Layout
    if (chk.ok && chk.steps[0].op === "cancel") {
      var was = holder();
      if (was) stopRun("Claude");
      back(key, { ok: 1, n: 0, d: 0, per: [], cut: 0, notes: [was ? "cancelled: " + was.ops.join(", ") + (was.at ? " (it was waiting for " + was.at + ")" : "") : "nothing was running"], tok: "" });
      return;
    }
    // LY-PRO W1: create makes the document first (designs new)
    var fresh = chk.ok && chk.steps[0].op === "create";
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && LY.findDoc(id); }).slice(0, 500) : [];
    if (!chk.ok || (!ids.length && !fresh) || busy) {
      if (busy) LY.toast(t("as.busy"), t("btn.stop"), function () { stopRun("owner"); });
      else LY.toast(t("as.bad"));
      var no = { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" };
      if (busy) no.holder = holder();
      back(key, no);
      return;
    }
    busy = true;
    LY.flushStory && LY.flushStory();
    var steps = chk.steps, notes = [], snaps = [], per = [], total = 0, saved = [], made = 0, why = "";
    var ctl = { signal: { aborted: false } };
    var slow = steps.some(slowStep);
    if (fresh) {
      var nd = window.LayoutPro.makeDoc(steps[0], LY.now());
      if (!LY.addNewDoc || !LY.addNewDoc(nd)) { busy = false; back(key, { failed: 1, why: "error" }); return; }
      ids = [nd.id];
      made = 1;
      steps = steps.slice(1);
      snaps.push({ id: nd.id, made: 1 });
    }
    var stopToast = function () { stopRun("owner"); };
    if (slow) LY.toast(t("as.working"), t("btn.stop"), stopToast);
    // LOCAL-1 bug (2026-11-18): a step that never answers (a local file,
    // a picture that does not decode) may not keep Layout busy for ever.
    // 60 s without progress stops the run; nothing more is changed and
    // the report says "timeout" with the file it waited for.
    var ended = false, skippedN = 0;
    ctl.last = Date.now();
    ctl.tick = function (at) { ctl.last = Date.now(); if (at) ctl.at = at; };
    run = { ops: chk.steps.map(function (st) { return st.op; }), since: Date.now(), ctl: ctl, stop: function (by) {
      if (ended) return;
      ctl.signal.aborted = true;
      why = "cancelled";
      notes.push("cancelled by " + by + (ctl.at ? " (it was waiting for " + String(ctl.at).slice(0, 200) + ")" : ""));
      finish({ why: "cancelled" });
    } };
    var dog = setInterval(function () {
      if (ended || Date.now() - ctl.last < WATCH_MS) return;
      ctl.signal.aborted = true;
      why = "timeout";
      notes.push("timeout: no answer for " + Math.round(WATCH_MS / 1000) + " s" + (ctl.at ? " (" + String(ctl.at).slice(0, 200) + ")" : ""));
      finish({ why: "timeout" });
    }, 2000);
    function oneDoc(id) {
      var cur = LY.findDoc(id);
      if (!cur) return Promise.resolve();
      var editing = steps.filter(function (s) { return s.op !== "rename"; });
      return LY.recipeGrey(cur, editing, ctl).then(function (ctx) {
        cur = LY.findDoc(id);
        if (!cur) return null;
        if (!slow || !LY.pro) return { ctx: ctx, envs: null };
        return LY.pro.prepare(cur, steps, ctx, notes, ctl).then(function (pr) { saved = saved.concat(pr.saved); skippedN += pr.skipped || 0; return { ctx: ctx, envs: pr.envs }; });
      }).then(function (pp) {
        if (!pp || ctl.signal.aborted) return;
        var ctx = pp.ctx;
        cur = LY.findDoc(id);   // it may have changed while the copies were made
        if (!cur) return;
        function envAt(i, now) {
          var e = pp.envs && LY.pro ? LY.pro.envOf(pp.envs[i]) : {};
          e.now = now; e.grey = ctx.grey;
          // house_pages: the house documents and the book's details
          e.docs = LY.data().docs;
          if (LY.pro && LY.pro.metaFor) e.meta = LY.pro.metaFor(cur);
          if (window.LY_AUTO) e.fill = window.LY_AUTO.fillFields;
          return e;
        }
        // GL-3: the steps prepare() skipped (a file it could not read) stay out
        var skipAt = function (i) { return !!(pp.envs && pp.envs[i] && pp.envs[i].skip); };
        var before = JSON.parse(JSON.stringify(cur)), work = JSON.parse(JSON.stringify(cur)), nw = LY.now(), k = 0;
        steps.forEach(function (st, i) { if (skipAt(i)) return; var e = envAt(i, nw); e.notes = notes; k += C.apply(work, st, e); });
        if (!k) return;
        var done = cur === LY.doc
          ? LY.op(function (w, now) { var n = 0; steps.forEach(function (st, i) { if (!skipAt(i)) n += C.apply(w, st, envAt(i, now)); }); return n ? undefined : false; })
          : LY.putDoc(work);
        if (!done) return;
        var now2 = LY.findDoc(id);
        var mine = snaps.filter(function (x) { return x.id === id; })[0];
        if (mine) mine.fp = fp(now2);
        else snaps.push({ id: id, before: before, fp: fp(now2) });
        pagesNote(before, now2, notes);
        per.push({ name: title(now2), n: k });
        total += k;
      });
    }
    var chain = Promise.resolve();
    ids.forEach(function (id) { chain = chain.then(function () { return oneDoc(id); }); });
    chain.then(function () { return finish(null); }, function (e) {
      if (ended) return;
      why = e && typeof e.why === "string" ? e.why : "";
      if (why) notes.push(why + (e.path ? ": " + String(e.path).slice(0, 200) : ""));
      else { try { console.error("[orOS] layout: the Assistant's change failed", e); } catch (x) {} }
      return finish(e);
    });
    function finish(err) {
      if (ended) return Promise.resolve();
      ended = true;
      clearInterval(dog);
      busy = false;
      run = null;
      snaps.forEach(function (x) { if (x.made && !x.fp) x.fp = fp(LY.findDoc(x.id)); });
      var rec = snaps.length ? { tok: newTok(), at: Date.now(), docs: snaps } : null;
      // GL-4: the report goes once the change is in the files and the
      // index, so read_in_app right after it reads the new document
      var settled = snaps.length && LY.settled ? LY.settled(20000) : Promise.resolve();
      return (rec ? put(rec) : Promise.resolve()).then(function () { return settled; }).then(function () {
        // the changed document opens, so the user sees what changed
        if (snaps.length === 1 && (!LY.doc || LY.doc.id !== snaps[0].id) && !document.querySelector("dialog[open]")) {
          if (LY.doc) LY.goHome();
          LY.openDoc(snaps[0].id);
        } else if (!LY.doc) LY.renderHome();
        if (!err && skippedN && !total && !saved.length) { err = { why: "skipped" }; why = why || "skipped"; }   // GL-3: nothing ran, every step skipped
        var rep = err && !snaps.length && !saved.length ? { failed: 1, why: why || "error", notes: notes.slice() }
          : { ok: 1, n: total, d: snaps.filter(function (x) { return !x.made || total; }).length, per: per.slice(0, 50), cut: 0, made: made, files: saved.length, saved: saved.slice(0, 60), notes: notes.slice(), tok: rec ? rec.tok : "" };
        if (rep.ok && skippedN) rep.skipped = skippedN;   // GL-3: the notes name them
        if (err && rep.ok) rep.stopped = 1;
        back(key, rep);
        var msg = !total ? (made ? t("as.made1") : t("as.done0")) : snaps.length === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: snaps.length });
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
      rec.docs.forEach(function (s) { if (s.made) { if (LY.dropDoc) LY.dropDoc(s.id); } else LY.restoreDoc(s.before); });
      rec.st = "undone";
      rec.docs = rec.docs.map(function (s) { return { id: s.id }; });   // nothing left to undo: the copies go
      return put(rec).then(function () {
        if (!LY.doc) LY.renderHome();
        LY.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  LY.assist = { edit: edit, undo: undo, fp: fp, holder: holder, stop: stopRun };
})();
