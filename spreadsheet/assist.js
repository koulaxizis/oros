/* ============================================================
   orOS Spreadsheet — assist.js: the Assistant's changes (AS-EDIT,
   wave SS1, v1.0.0)
   The Assistant's edit_in_app card hands Spreadsheet a list of
   commands (commands.js) once the user presses Apply:
     __orosOpenAt("spreadsheet", { edit: { key, chat, docs: [sheet ids], steps } })
   Spreadsheet checks the commands again (it never trusts the
   request), applies them to a copy of the workbook (commands.js
   work(), apply()) and writes only what changed through its own
   writes (cells per field with rawSet / rawDel, sheets with a new
   mtime, charts and rules with applyObj), so it syncs like any other
   change; the same change is one step of the app's own Undo. It
   keeps what Undo needs on this device and leaves its report for the
   card in the shell (orosAssistAtt.rb[key], as AS-RB):
     { ok, n, d, per: [{ name, n }], cut: 0, notes, tok } | { failed, why }
   Undo, from the card, the change history or this notice:
     __orosOpenAt("spreadsheet", { editUndo: { key, tok } })
     → { ok } | { failed, why: "gone" | "undone" | "changed" }
   Undo puts every cell, sheet, chart and rule back only if none of
   them was changed since, so a late Undo never takes away newer work.
   Undo data: IndexedDB oros-spreadsheet-assist (store "undo"), this
   device only, 30 days, 50 entries. Loaded on the first request
   (spreadsheet.js), with commands.js.
   ============================================================ */
(function () {
  "use strict";

  var H = window.SheetAssistHost, K = window.SheetCommands;
  if (!H || !K) return;
  var t = H.t;

  /* ---------- undo data (this device) ---------- */
  var DB = "oros-spreadsheet-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
    return "ss-" + s;
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

  /* ---------- reading and writing the app's state ---------- */
  function clone(o) { return o === undefined || o === null ? null : JSON.parse(JSON.stringify(o)); }
  /* a cell as Undo and the comparison see it: { v, f? } | null */
  function cellNow(k) {
    var cel = H.state().cells[k];
    if (!cel) return null;
    var o = { v: cel.v }, f = H.canonF(cel.f);
    if (f) o.f = f;
    return o;
  }
  function sameCell(a, b) {
    var fa = a ? H.canonF(a.f) || null : null, fb = b ? H.canonF(b.f) || null : null;
    var va = a && (a.v !== "" || fa) ? a.v : null, vb = b && (b.v !== "" || fb) ? b.v : null;
    return va === vb && JSON.stringify(fa) === JSON.stringify(fb);
  }
  function writeCell(k, x) {
    var p = k.split("|");
    if (!x || (x.v === "" && !H.canonF(x.f))) { if (H.state().cells[k]) H.rawDel(p[0], +p[1], +p[2]); }
    else H.rawSet(p[0], +p[1], +p[2], x.v, x.f);
  }
  /* the parts of a sheet the commands change */
  function metaOf(sh) {
    var o = { name: typeof sh.name === "string" ? sh.name : null, rows: sh.rows, cols: sh.cols, cw: clone(sh.cw) || {} };
    if (o.name === null && sh.bi) o.bi = clone(sh.bi);
    if (sh.fz) o.fz = clone(sh.fz);
    if (sh.rh && Object.keys(sh.rh).length) o.rh = clone(sh.rh);
    return o;
  }
  function writeMeta(sh, m) {
    sh.name = m.name;
    if (m.bi) sh.bi = clone(m.bi); else delete sh.bi;
    sh.rows = m.rows; sh.cols = m.cols; sh.cw = clone(m.cw) || {};
    if (m.fz) sh.fz = clone(m.fz); else delete sh.fz;
    if (m.rh) sh.rh = clone(m.rh); else delete sh.rh;
    sh.mtime = H.now();
  }
  function dimsOf(m) { var o = { rows: m.rows, cols: m.cols, cw: clone(m.cw) || {} }; if (m.fz) o.fz = clone(m.fz); if (m.rh) o.rh = clone(m.rh); return o; }
  function objNow(kind, id) { var x = H.state()[kind][id]; return x ? clone(x) : null; }
  function objBody(x) { if (!x) return null; var o = clone(x); delete o.mtime; return JSON.stringify(o); }
  /* what the fingerprint is taken of: everything a change wrote */
  function stateOf(rec) {
    return JSON.stringify([
      rec.cells.map(function (c) { return [c[0], cellNow(c[0])]; }),
      rec.sheets.map(function (s) { var sh = H.getSheet(s.id); return sh ? metaOf(sh) : null; }),
      rec.objs.map(function (o) { return objBody(objNow(o.kind, o.id)); })
    ]);
  }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = K.check(rq && rq.steps);
    H.flush();
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && H.getSheet(id); }).slice(0, 300) : [];
    if (!chk.ok || !ids.length || busy) {
      H.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    var notes = [], per = [], perIds = [], total = 0, err = null, lang = H.lang();
    var rec = { tok: newTok(), at: Date.now(), cells: [], sheets: [], objs: [] }, entries = [];
    try {
      var st = H.state(), before = K.work(st), w = K.work(st), env = { notes: notes, lang: lang };
      ids.forEach(function (id) {
        var k = 0;
        chk.steps.forEach(function (s) { k += K.apply(w, id, s, env); });
        if (k) { per.push({ name: K.sheetName(K.sheetOf(w, id), lang), n: k }); perIds.push(id); total += k; }
      });
      /* cells: every key either copy has */
      var keys = {};
      Object.keys(before.cells).forEach(function (k) { keys[k] = 1; });
      Object.keys(w.cells).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).sort().forEach(function (k) {
        var a = before.cells[k] || null, b = w.cells[k] || null;
        if (sameCell(a, b)) return;
        var full = st.cells[k] ? { v: st.cells[k].v } : null;
        if (full && st.cells[k].f) full.f = clone(st.cells[k].f);
        if (full && typeof st.cells[k].cv === "string") full.cv = st.cells[k].cv;
        var bs = cellNow(k);
        writeCell(k, b);
        rec.cells.push([k, full]);
        entries.push({ key: k, before: bs, after: cellNow(k) });
      });
      /* sheets: size, widths, heights, frozen panes, name */
      w.sheets.forEach(function (ws) {
        var sh = H.getSheet(ws.id);
        if (!sh) return;
        var m0 = metaOf(sh), m1 = metaOf(ws);
        if (JSON.stringify(m0) === JSON.stringify(m1)) return;
        writeMeta(sh, m1);
        rec.sheets.push({ id: ws.id, before: m0 });
        if (JSON.stringify(dimsOf(m0)) !== JSON.stringify(dimsOf(m1))) entries.push({ dim: true, sid: ws.id, before: dimsOf(m0), after: dimsOf(m1) });
      });
      /* charts and conditional-format rules */
      ["charts", "cf"].forEach(function (kind) {
        var all = {};
        Object.keys(before[kind]).forEach(function (id) { all[id] = 1; });
        Object.keys(w[kind]).forEach(function (id) { all[id] = 1; });
        Object.keys(all).forEach(function (id) {
          if (objBody(before[kind][id]) === objBody(w[kind][id])) return;
          var b0 = objNow(kind, id);
          H.applyObj(kind, id, w[kind][id] || null);
          rec.objs.push({ kind: kind, id: id, before: b0 });
          entries.push({ obj: kind, id: id, before: b0, after: objNow(kind, id) });
        });
      });
    } catch (e) {
      err = e;
      try { console.error("[orOS] spreadsheet: the Assistant's change failed", e); } catch (x) {}
    }
    var changed = rec.cells.length + rec.sheets.length + rec.objs.length > 0;
    if (changed) {
      H.push(entries);
      H.done();
      rec.fp = fp(stateOf(rec));
    }
    busy = false;
    (changed ? put(rec) : Promise.resolve()).then(function () {
      /* the changed sheet opens, so the user sees what changed */
      if (perIds.length === 1 && changed && perIds[0] !== H.activeId() && H.getSheet(perIds[0]) && !document.querySelector("dialog[open]")) H.switchTo(perIds[0]);
      var rep = err && !changed ? { failed: 1, why: "error" }
        : { ok: 1, n: changed ? total : 0, d: changed ? per.length : 0, per: changed ? per.slice(0, 50) : [], cut: 0, notes: notes.slice(), tok: changed ? rec.tok : "" };
      back(key, rep);
      var msg = !changed ? t("as.done0") : per.length === 1 ? t("as.done1").replace("{n}", total) : t("as.done").replace("{n}", total).replace("{d}", per.length);
      if (changed) H.undoToast(msg, function () { undo({ tok: rec.tok }); });
      else H.toast(msg);
    });
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.cells)) { H.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { H.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      H.flush();
      var lost = rec.sheets.some(function (s) { return !H.getSheet(s.id); }) ||
        rec.cells.some(function (c) { return !H.getSheet(c[0].split("|")[0]); });
      if (lost || fp(stateOf(rec)) !== rec.fp) { H.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      var entries = [];
      rec.cells.forEach(function (c) {
        var bs = cellNow(c[0]);
        writeCell(c[0], c[1]);
        var cel = H.state().cells[c[0]];
        if (c[1] && c[1].cv && cel && cel.v === c[1].v) cel.cv = c[1].cv;
        entries.push({ key: c[0], before: bs, after: cellNow(c[0]) });
      });
      rec.sheets.forEach(function (s) {
        var sh = H.getSheet(s.id), m0 = metaOf(sh);
        writeMeta(sh, s.before);
        entries.push({ dim: true, sid: s.id, before: dimsOf(m0), after: dimsOf(s.before) });
      });
      rec.objs.forEach(function (o) {
        var b0 = objNow(o.kind, o.id);
        H.applyObj(o.kind, o.id, o.before);
        entries.push({ obj: o.kind, id: o.id, before: b0, after: objNow(o.kind, o.id) });
      });
      H.push(entries);
      H.done();
      rec.st = "undone";
      rec.cells = []; rec.sheets = []; rec.objs = [];   /* nothing left to undo: the copies go */
      return put(rec).then(function () {
        H.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  window.SheetAssist = { edit: edit, undo: undo, fp: fp };
})();
