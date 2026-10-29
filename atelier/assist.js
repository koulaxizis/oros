// ============================================================
// orOS Atelier — assist.js: the Assistant's changes (AS-EDIT, waves
// AC1 + AC2, v1.1.0)
// The Assistant's edit_in_app card hands Atelier a list of commands
// (commands.js) once the user presses Apply:
//   __orosOpenAt("atelier", { edit: { key, chat, docs: [ids], steps } })
// Atelier checks the commands again (it never trusts the request),
// applies them to the designs (AT.putDoc: the open design keeps an
// undo step), keeps what Undo needs on this device and leaves its
// report for the card in the shell (orosAssistAtt.rb[key], as AS-RB):
//   { ok, n, d, per: [{ name, n }], cut, made, files, notes, tok } | { failed, why }
// AC2: resize with copies and create make new designs (made; Undo
// removes them if unchanged since), export hands the files to the
// save dialog (files).
// Undo, from the card, the change history or this toast:
//   __orosOpenAt("atelier", { editUndo: { key, tok } })
//   → { ok } | { failed, why: "gone" | "undone" | "changed" }
// Undo puts every design back (AT.restoreDoc, as new edits) only if
// none was changed since the Assistant changed it, so a late Undo
// never takes away newer work. Undo data: IndexedDB oros-atelier-assist
// (store "undo"), this device only, 30 days, 50 entries.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, M = AT.M, AX = AT.AX, t = AT.t, el = AT.el;
  var C = window.AtelierCommands;
  if (!C) return;

  var STR = {
    en: {
      "as.working": "The Assistant is changing {n} designs…", "as.working1": "The Assistant is changing the design…",
      "as.cutting": "Background {i} of {n}…", "as.stop": "Stop",
      "as.done": "The Assistant changed {n} things in {d} designs.", "as.done1": "The Assistant changed {n} things in the design.",
      "as.done0": "Nothing needed changing.", "as.bad": "The Assistant's request could not be read. Nothing was changed.",
      "as.undone": "The Assistant's change was undone.", "as.changed": "These designs were changed since, so the Assistant's change was not undone.",
      "as.gone": "There is nothing left to undo.", "as.stopped": "Stopped. What was done stays (Undo brings it back).",
      "as.made": "The Assistant made {n} new designs.", "as.files": "{n} files are ready.",
      "as.filesTitle": "Your files", "as.save": "Save…", "as.later": "Not now"
    },
    el: {
      "as.working": "Ο Βοηθός αλλάζει {n} σχέδια…", "as.working1": "Ο Βοηθός αλλάζει το σχέδιο…",
      "as.cutting": "Φόντο {i} από {n}…", "as.stop": "Διακοπή",
      "as.done": "Ο Βοηθός άλλαξε {n} στοιχεία σε {d} σχέδια.", "as.done1": "Ο Βοηθός άλλαξε {n} στοιχεία στο σχέδιο.",
      "as.done0": "Δεν χρειάστηκε καμία αλλαγή.", "as.bad": "Το αίτημα του Βοηθού δεν διαβάστηκε. Δεν άλλαξε τίποτα.",
      "as.undone": "Η αλλαγή του Βοηθού αναιρέθηκε.", "as.changed": "Τα σχέδια άλλαξαν στο μεταξύ, γι' αυτό η αλλαγή του Βοηθού δεν αναιρέθηκε.",
      "as.gone": "Δεν έμεινε κάτι για αναίρεση.", "as.stopped": "Διακόπηκε. Ό,τι έγινε μένει (η Αναίρεση το επαναφέρει).",
      "as.made": "Ο Βοηθός έφτιαξε {n} νέα σχέδια.", "as.files": "{n} αρχεία είναι έτοιμα.",
      "as.filesTitle": "Τα αρχεία σου", "as.save": "Αποθήκευση…", "as.later": "Όχι τώρα"
    }
  };
  AT.addStrings(STR);

  // ---------- undo data (this device) ----------
  var DB = "oros-atelier-assist", KEEP_MS = 30 * 864e5, KEEP_N = 50;
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
  // A design's fingerprint: equal only while nobody changed it.
  function fp(doc) {
    var s = JSON.stringify(doc), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length + ":" + (h >>> 0).toString(16);
  }
  function newTok() {
    var b = new Uint8Array(9), s = "";
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 9; i++) b[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2);
    return "ae-" + s;
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

  var BRAND_KEY = "oros-atelier-brand";
  function brandKit() {
    try { var B = window.AtelierBrand && window.AtelierBrand.norm(JSON.parse(localStorage.getItem(BRAND_KEY) || "null")); return B && (B.colors.length || Object.keys(B.fonts).length) ? B : null; }
    catch (e) { return null; }
  }
  // An icon for a word (the library's ids and English and Greek keywords).
  function findIcon(word) {
    var L = window.ATELIER_ICONS && window.ATELIER_ICONS.list, w = String(word || "").toLowerCase().trim();
    if (!L || !w) return "star";
    var best = null, score = 0;
    L.forEach(function (ic) {
      var id = ic[0], keys = (" " + ic[2] + " " + (ic[3] || "") + " ").toLowerCase(), sc = id === w ? 4 : id.split("-").indexOf(w) >= 0 ? 3 : keys.indexOf(" " + w + " ") >= 0 ? 2 : keys.indexOf(w) >= 0 ? 1 : 0;
      if (sc > score) { score = sc; best = id; }
    });
    return best || "star";
  }
  function env(notes) {
    return {
      now: AT.now(), newId: M.newId, normItem: M.normItem, notes: notes,
      textHeight: function (it) { return AX.textHeight(M.normItem(it) || it); },
      addBackground: AX.addBackground, addItem: AX.addItem, findIcon: findIcon,
      relaid: AT.io && AT.io.relaid, brand: brandKit(),
      // new texts the command leaves unstyled take My style (style.js)
      look: function (doc, role) { return AT.style ? AT.style.look(doc, role) : null; },
      newDesign: function (o) { return AX.newDesign(o, AT.now()); }
    };
  }
  function cutPhotos(doc, st) {
    return C.pick(doc, st).filter(function (it) { return it.ax.k === "photo" && !it.ax.vid && it.a && !/-cutout\.png$/i.test(it.nm || ""); });
  }
  function sizeName(z) { return Math.round(z.w) + " × " + Math.round(z.h) + " " + (z.u || "px"); }

  var busy = false;
  function edit(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "";
    var chk = C.check(rq && rq.steps);
    var fresh = chk.ok && chk.steps[0].op === "create";
    var ids = rq && Array.isArray(rq.docs) ? rq.docs.filter(function (id) { return typeof id === "string" && AT.findDoc(id); }).slice(0, 500) : [];
    if (!chk.ok || (!ids.length && !fresh) || busy) {
      AT.toast(t("as.bad"));
      back(key, { failed: 1, why: !chk.ok ? "bad" : busy ? "busy" : "gone" });
      return;
    }
    busy = true;
    if (AT.ed && AT.ed.exitText) AT.ed.exitText();
    AT.endGesture();
    var steps = chk.steps, notes = [], snaps = [], made = [], per = [], files = [], total = 0, docsChanged = 0, cut = 0;
    var slow = steps.some(function (s) { var k = C.CATALOG[s.op].kind; return k === "async" || k === "out"; });
    var CUT = window.AtelierCutout, cutOne = AT.recipes && AT.recipes.cutOne;
    var ctl = new AbortController(), stat = null, dlg = AT.$("dlg");
    if (slow) {
      AT.openDialog(t("app.name"), function (body, close) {
        stat = el("p", "hint rc-stat", ids.length > 1 ? t("as.working", { n: ids.length }) : t("as.working1"));
        body.appendChild(stat);
        var act = el("div", "dlg-actions"), b = el("button", "btn", t("as.stop"));
        b.type = "button";
        b.addEventListener("click", function () { ctl.abort(); close(); });
        act.appendChild(b);
        body.appendChild(act);
      });
    }
    // A design being changed: w the copy, before (null for one this
    // change made), k its count.
    function commit(o) {
      if (o.made) {
        AT.putDoc(o.w);
        if (o.k) { per.push({ name: AT.docTitle(AT.findDoc(o.id)), n: o.k }); total += o.k; docsChanged++; }
        return;
      }
      if (!o.k) return;
      AT.putDoc(o.w);
      var now = AT.findDoc(o.id);
      snaps.push({ id: o.id, before: o.before, fp: fp(now) });
      per.push({ name: AT.docTitle(now), n: o.k });
      total += o.k;
      docsChanged++;
    }
    function oneDoc(start) {
      var works = [start], chain = Promise.resolve();
      steps.forEach(function (st) {
        chain = chain.then(function () {
          if (ctl.signal.aborted) return;
          var kind = C.CATALOG[st.op].kind;
          if (kind === "new") return;
          if (kind === "doc" || (kind === "size" && !st.copies)) { works.forEach(function (o) { o.k += C.apply(o.w, st, env(notes)); }); return; }
          if (kind === "size") {
            // the designs so far are kept; their copies are the new work
            var next = [];
            works.forEach(function (o) {
              commit(o);
              o.k = 0;
              var list = st.sizes.map(function (z) {
                var p = C.ptSize(z), c = AT.io.relaid(o.w, p.w, p.h, p.unit);
                c.name = t("resize.copy", { name: AT.docTitle(o.w), size: sizeName(z) }).slice(0, 120);
                return c;
              });
              AT.addCopies(list, o.id).forEach(function (nid) {
                made.push(nid);
                next.push({ id: nid, w: JSON.parse(JSON.stringify(AT.findDoc(nid))), before: null, k: 0, made: 1 });
              });
            });
            works = next;
            return;
          }
          if (kind === "out") {
            var c3 = Promise.resolve();
            works.forEach(function (o) {
              c3 = c3.then(function () {
                if (ctl.signal.aborted) return;
                return AT.io.renderFiles(M.normDoc(JSON.parse(JSON.stringify(o.w))), st).then(function (fl) { files = files.concat(fl); });
              });
            });
            return c3;
          }
          if (!CUT || !cutOne) { if (notes.indexOf("noCut") < 0) notes.push("noCut"); return; }
          var jobs = [];
          works.forEach(function (o) { cutPhotos(o.w, st).forEach(function (it) { jobs.push({ o: o, it: it }); }); });
          var c2 = Promise.resolve();
          jobs.forEach(function (j, i) {
            c2 = c2.then(function () {
              if (ctl.signal.aborted) return;
              if (stat) stat.textContent = t("as.cutting", { i: i + 1, n: jobs.length });
              return cutOne(j.o.w, j.it, ctl.signal).then(function () { j.o.k++; cut++; });
            });
          });
          return c2;
        });
      });
      return chain.then(function () { works.forEach(commit); });
    }
    var chain = Promise.resolve();
    if (fresh) {
      // create: the new design is made first; Undo removes it
      var nd = C.makeNew(steps[0], env(notes));
      AT.addDocs([nd], "");
      made.push(nd.id);
      chain = oneDoc({ id: nd.id, w: JSON.parse(JSON.stringify(AT.findDoc(nd.id))), before: null, k: 0, made: 1 });
    } else {
      ids.forEach(function (id) {
        chain = chain.then(function () {
          var src = AT.findDoc(id);
          if (!src || ctl.signal.aborted) return;
          return oneDoc({ id: id, w: JSON.parse(JSON.stringify(src)), before: JSON.parse(JSON.stringify(src)), k: 0 });
        });
      });
    }
    chain.then(function () { return finish(null); }, function (e) {
      try { console.error("[orOS] atelier: the Assistant's change failed", e); } catch (x) {}
      return finish(e);
    });
    // The files wait for a press of Save: the Apply press was in the
    // Assistant, and a save dialog needs one here.
    function offerFiles() {
      AT.openDialog(t("as.filesTitle"), function (body, close) {
        body.appendChild(el("p", "hint", t("as.files", { n: files.length })));
        var act = el("div", "dlg-actions"), no = el("button", "btn", t("as.later")), yes = el("button", "btn primary", t("as.save"));
        no.type = yes.type = "button";
        no.addEventListener("click", close);
        yes.addEventListener("click", function () { close(); saveFiles(); });
        act.appendChild(no); act.appendChild(yes);
        body.appendChild(act);
      });
    }
    function saveFiles() {
      if (files.length === 1) return AT.io.saveBlob(files[0].blob, files[0].name, files[0].blob.type, files[0].name, files[0].name.replace(/^.*(\.[a-z]+)$/, "$1"));
      return Promise.all(files.map(function (f) { return f.blob.arrayBuffer(); })).then(function (bufs) {
        var taken = {}, list = files.map(function (f, i) {
          var nm = f.name, b = nm.replace(/(\.[a-z]+)$/, ""), ext = nm.slice(b.length), j = 2;
          while (taken[nm.toLowerCase()]) nm = b + " (" + (j++) + ")" + ext;
          taken[nm.toLowerCase()] = 1;
          return { name: nm, data: new Uint8Array(bufs[i]) };
        });
        return AT.io.saveBlob(new Blob([window.AtelierZip.write(list, new Date())], { type: "application/zip" }), "atelier.zip", "application/zip", "ZIP", ".zip");
      });
    }
    function finish(err) {
      busy = false;
      if (slow && dlg.open) dlg.close();
      var stopped = ctl.signal.aborted;
      // copies and new designs: their state now, so Undo can tell
      var madeFp = made.filter(function (id) { return AT.findDoc(id); }).map(function (id) { return { id: id, fp: fp(AT.findDoc(id)), made: 1 }; });
      var rec = snaps.length || madeFp.length ? { tok: newTok(), at: Date.now(), docs: snaps.concat(madeFp) } : null;
      return (rec ? put(rec) : Promise.resolve()).then(function () {
        if (AT.dropThumbs) AT.dropThumbs();
        // the changed (or new) design opens, so the user sees what changed
        var show = fresh || (made.length === 1 && !snaps.length) ? made[0] : snaps.length === 1 && !made.length ? snaps[0].id : "";
        if (show && (!AT.doc || AT.doc.id !== show) && !document.querySelector("dialog[open]")) {
          if (AT.doc) AT.goHome();
          AT.openDoc(show);
        } else if (!AT.doc) AT.renderHome();
        var rep = err && !rec ? { failed: 1, why: "error" }
          : { ok: 1, n: total, d: docsChanged, per: per.slice(0, 50), cut: cut, made: made.length, files: files.length, notes: notes.slice(), tok: rec ? rec.tok : "" };
        if (stopped) rep.stopped = 1;
        back(key, rep);
        var msg = stopped ? t("as.stopped") : made.length && !total ? t("as.made", { n: made.length })
          : !total ? (files.length ? t("as.files", { n: files.length }) : t("as.done0"))
          : (docsChanged === 1 ? t("as.done1", { n: total }) : t("as.done", { n: total, d: docsChanged })) + (made.length ? " " + t("as.made", { n: made.length }) : "");
        if (rec) AT.toast(msg, t("btn.undo"), function () { undo({ tok: rec.tok }); });
        else if (!files.length) AT.toast(msg);
        if (files.length && !stopped) offerFiles();
      });
    }
  }

  function undo(rq) {
    var key = rq && typeof rq.key === "string" ? rq.key : "", tok = rq && typeof rq.tok === "string" ? rq.tok : "";
    return get(tok).then(function (rec) {
      if (!rec || !Array.isArray(rec.docs)) { AT.toast(t("as.gone")); back(key, { failed: 1, why: "gone" }); return; }
      if (rec.st === "undone") { AT.toast(t("as.gone")); back(key, { failed: 1, why: "undone" }); return; }
      if (AT.ed && AT.ed.exitText) AT.ed.exitText();
      AT.endGesture();
      var changed = rec.docs.some(function (s) { var d = AT.findDoc(s.id); return !d || fp(d) !== s.fp; });
      if (changed) { AT.toast(t("as.changed")); back(key, { failed: 1, why: "changed" }); return; }
      rec.docs.forEach(function (s) { if (s.made) AT.dropDoc(s.id); else AT.restoreDoc(s.id, s.before); });
      rec.st = "undone";
      rec.docs = rec.docs.map(function (s) { return { id: s.id }; });   // nothing left to undo: the copies go
      return put(rec).then(function () {
        if (AT.dropThumbs) AT.dropThumbs();
        if (!AT.doc) AT.renderHome();
        AT.toast(t("as.undone"));
        back(key, { ok: 1 });
      });
    });
  }

  AT.assist = { edit: edit, undo: undo, fp: fp };
})();
