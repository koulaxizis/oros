// ============================================================
// orOS Files — photo-search.js (Photos › search by description)
// ------------------------------------------------------------
// "dog on the beach" finds photos that have no name or tag saying so.
// CLIP (clip.js / clip-core.js / clip-worker.js) turns every photo's
// small picture into a vector once, and each search into another;
// the closest ones are the answer. Greek searches are put into
// English on the device first (translate/engine.js, the el → en
// model), because CLIP reads English.
//   - searches in another language (Greek, or the interface language
//     when orOS can translate it) are put into English first
//   - nothing is downloaded until the person presses Download
//   - the index is made from the thumbnails Photos already keeps
//     (oros-files-thumbs; a missing one is made from the file, as a
//     tile in view would), a few photos at a time while Photos is
//     open and the page is visible, and goes on where it stopped
//   - cloud-only photos (orOS Drive) are indexed once their thumbnail
//     exists (when they have been seen); nothing is fetched for this
//   - videos are indexed by their thumbnail frame
//   - nothing leaves the device; nothing here syncs
// photos.js loads this file the first time the search is used and
// calls OrosPhotoSearch.attach(api) with what it needs (see below).
//   open()         the search box (and the download, the first time)
//   similar(rec)   photos that look like this one (the viewer button)
//   manage()       the More menu entry: status, remove the model
//   stop()         Photos left: the indexing pauses
// ============================================================
(function () {
  "use strict";

  var api = null;                 // from photos.js (attach)
  var CORE = window.OrosClipCore;
  var BATCH_WAIT = 30;            // ms between photos (keeps the page smooth)
  var TRANSLATE_JS = "../translate/engine.js";

  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var STRINGS = {
    en: {
      "ps.button":     "Search by description",
      "ps.title":      "Search by description",
      "ps.label":      "Describe the photo",
      "ps.hint":       "For example: dog on the beach, birthday cake, snowy mountains",
      "ps.go":         "Search",
      "ps.cancel":     "Close",
      "ps.intro":      "orOS can find photos by what is in them. For that it downloads a picture-and-words model once (about {mb} MB) and goes through your photos on this device. Your photos and your searches never leave the device, and nothing of this syncs.",
      "ps.introEl":    "Searches in your language are first put into English on the device (the translation model, about {mb} MB more).",
      "ps.download":   "Download",
      "ps.downloading": "Downloading… {p}%",
      "ps.failed":     "The download did not finish. Is the device online? Try again later.",
      "ps.hash":       "The downloaded file is not the expected one, so it was not kept. Try again later.",
      "ps.quota":      "There is not enough space on this device for the model.",
      "ps.indexing":   "Getting to know your photos… {i} of {n}. Results get better as this goes on.",
      "ps.indexed":    "All {n} photos are ready for searching.",
      "ps.waitCloud":  "{n} photos only in the cloud are left out until you have seen them in Photos.",
      "ps.results":    "“{q}”",
      "ps.similarTo":  "Like “{name}”",
      "ps.none":       "No photo looks like this description. Try other words.",
      "ps.partial":    "Showing what the photos checked so far suggest ({i} of {n}). The list updates by itself.",
      "ps.translated": "Searched for: {q}",
      "ps.notTranslated": "The search could not be put into English on this device; the results may be weak.",
      "ps.similar":    "Similar photos",
      "ps.manage":     "Search by description…",
      "ps.status":     "Model on this device. {n} photos indexed.",
      "ps.remove":     "Remove the model and the index",
      "ps.removeAsk":  "Remove the search model (about {mb} MB) and the index from this device? Your photos stay as they are.",
      "ps.removed":    "The search model and the index were removed.",
      "ps.engine":     "The search could not run on this device."
    },
    el: {
      "ps.button":     "Αναζήτηση με περιγραφή",
      "ps.title":      "Αναζήτηση με περιγραφή",
      "ps.label":      "Περιέγραψε τη φωτογραφία",
      "ps.hint":       "Για παράδειγμα: σκύλος στην παραλία, τούρτα γενεθλίων, χιονισμένα βουνά",
      "ps.go":         "Αναζήτηση",
      "ps.cancel":     "Κλείσιμο",
      "ps.intro":      "Το orOS μπορεί να βρίσκει φωτογραφίες από αυτό που δείχνουν. Γι' αυτό κατεβάζει μία φορά ένα μοντέλο εικόνας και λέξεων (περίπου {mb} MB) και περνά τις φωτογραφίες σου σε αυτή τη συσκευή. Οι φωτογραφίες και οι αναζητήσεις σου δεν φεύγουν ποτέ από τη συσκευή και τίποτα από αυτά δεν συγχρονίζεται.",
      "ps.introEl":    "Οι ελληνικές αναζητήσεις μεταφράζονται πρώτα στα αγγλικά στη συσκευή (το μοντέλο μετάφρασης, περίπου {mb} MB ακόμα).",
      "ps.download":   "Λήψη",
      "ps.downloading": "Λήψη… {p}%",
      "ps.failed":     "Η λήψη δεν ολοκληρώθηκε. Είναι η συσκευή online; Δοκίμασε ξανά αργότερα.",
      "ps.hash":       "Το αρχείο που κατέβηκε δεν είναι το αναμενόμενο, οπότε δεν κρατήθηκε. Δοκίμασε ξανά αργότερα.",
      "ps.quota":      "Δεν υπάρχει αρκετός χώρος σε αυτή τη συσκευή για το μοντέλο.",
      "ps.indexing":   "Γνωρίζω τις φωτογραφίες σου… {i} από {n}. Τα αποτελέσματα βελτιώνονται όσο προχωρά.",
      "ps.indexed":    "Και οι {n} φωτογραφίες είναι έτοιμες για αναζήτηση.",
      "ps.waitCloud":  "{n} φωτογραφίες που είναι μόνο στο cloud μένουν έξω μέχρι να τις δεις στις Φωτογραφίες.",
      "ps.results":    "«{q}»",
      "ps.similarTo":  "Σαν το «{name}»",
      "ps.none":       "Καμία φωτογραφία δεν ταιριάζει με την περιγραφή. Δοκίμασε άλλες λέξεις.",
      "ps.partial":    "Δείχνω ό,τι βγαίνει από τις φωτογραφίες που έχω δει ως τώρα ({i} από {n}). Η λίστα ενημερώνεται μόνη της.",
      "ps.translated": "Αναζητήθηκε: {q}",
      "ps.notTranslated": "Η αναζήτηση δεν μεταφράστηκε στα αγγλικά σε αυτή τη συσκευή· τα αποτελέσματα μπορεί να είναι φτωχά.",
      "ps.similar":    "Παρόμοιες φωτογραφίες",
      "ps.manage":     "Αναζήτηση με περιγραφή…",
      "ps.status":     "Το μοντέλο είναι σε αυτή τη συσκευή. {n} φωτογραφίες έτοιμες.",
      "ps.remove":     "Αφαίρεση του μοντέλου και του ευρετηρίου",
      "ps.removeAsk":  "Να αφαιρεθεί το μοντέλο αναζήτησης (περίπου {mb} MB) και το ευρετήριο από αυτή τη συσκευή; Οι φωτογραφίες σου μένουν όπως είναι.",
      "ps.removed":    "Το μοντέλο αναζήτησης και το ευρετήριο αφαιρέθηκαν.",
      "ps.engine":     "Η αναζήτηση δεν μπόρεσε να τρέξει σε αυτή τη συσκευή."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clip() { return window.OrosClip || null; }
  // Photos resumes the index at its next opening while this is set.
  function setOn(on) {
    try { if (on) localStorage.setItem("oros-files-clip-on", "1"); else localStorage.removeItem("oros-files-clip-on"); } catch (e) { /* private mode */ }
  }
  var GREEK = /[Ͱ-Ͽἀ-῿]/;
  function isGreek(s) { return GREEK.test(s); }

  // ---------- translation (Greek → English) ----------
  var trP = null;
  function translator() {
    if (window.OrosTranslate) return Promise.resolve(window.OrosTranslate);
    if (!trP) {
      trP = new Promise(function (resolve) {
        var s = document.createElement("script");
        s.src = TRANSLATE_JS;
        s.onload = function () { resolve(window.OrosTranslate || null); };
        s.onerror = function () { trP = null; resolve(null); };
        document.head.appendChild(s);
      });
    }
    return trP;
  }
  // The translation model of the interface language (Greek, German…),
  // downloaded with CLIP so searches in it work from the first one.
  function langMb() {
    if (LANG === "en") return Promise.resolve(0);
    return translator().then(function (tr) {
      if (!tr || tr.froms().indexOf(LANG) < 0) return 0;
      return Promise.resolve(tr.status(LANG, "en")).then(function (st) { return st && !st.ok ? Math.round(st.mb || 0) : 0; }, function () { return 0; });
    });
  }
  // → { q (what CLIP reads), shown (English, when it was translated), failed }
  // Greek letters are always Greek; Latin letters are taken as English
  // unless the interface language is another one that orOS can
  // translate from (a German interface: German searches).
  function toEnglish(q) {
    var from = isGreek(q) ? "el" : LANG !== "en" && LANG !== "el" ? LANG : "";
    if (!from) return Promise.resolve({ q: q });
    return translator().then(function (tr) {
      if (!tr || tr.froms().indexOf(from) < 0) return { q: q, failed: from === "el" };
      if (from !== "el" && tr.detect(q) === "en") return { q: q };
      return tr.translate(q, { from: from, to: "en", engine: "bergamot" }).then(function (r) {
        var en = r && r.text ? String(r.text).trim() : "";
        return en ? { q: en, shown: en } : { q: q, failed: true };
      }, function () { return { q: q, failed: true }; });
    });
  }

  // ---------- the index ----------
  // ix: { running, i, n, cloudLeft, keys: { thumbKey: true } }
  var ix = { running: false, i: 0, n: 0, cloudLeft: 0, have: null, gen: 0 };
  var listeners = [];
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* a closed dialog */ } }); }

  function candidates() {
    return api.recs().filter(function (r) { return (r.kind === "image" || r.kind === "video") && !api.isDoc(r); });
  }
  function thumbFor(r) {
    var key = api.thumbKey(r);
    return api.getThumb(key).then(function (b) {
      if (b) return b;
      if (r.cloud) return null;                     // never fetched for the index
      return api.makeThumbOf(r).catch(function () { return null; });
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible() { return !document.hidden; }

  function startIndex() {
    var C = clip();
    if (!C || ix.running || !api.active()) return Promise.resolve();
    var gen = ++ix.gen;
    ix.running = true;
    return C.vecs().then(function (list) {
      var have = {};
      list.forEach(function (x) { have[x.k] = true; });
      var recs = candidates(), wanted = {}, todo = [];
      recs.forEach(function (r) { var k = api.thumbKey(r); wanted[k] = true; if (!have[k]) todo.push(r); });
      // Vectors of photos that are gone (deleted, renamed with a new key)
      var gone = Object.keys(have).filter(function (k) { return !wanted[k]; });
      ix.n = recs.length; ix.i = recs.length - todo.length; ix.cloudLeft = 0; ix.have = have;
      notify();
      // Newest first: what the person most likely looks for.
      todo.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
      var j = 0;
      function next() {
        if (gen !== ix.gen || !api.active()) return Promise.resolve();
        if (j >= todo.length) return Promise.resolve();
        if (!visible()) return sleep(1000).then(next);
        var r = todo[j++];
        return thumbFor(r).then(function (b) {
          if (!b) { if (r.cloud) ix.cloudLeft++; return; }
          return C.embedImage(b).then(function (vec) {
            var k = api.thumbKey(r);
            have[k] = true;
            ix.i++;
            return C.putVec(k, vec);
          });
        }).catch(function (e) {
          if (e && (e.code === "engine" || e.code === "not-installed" || e.code === "quota")) throw e;
        }).then(function () {
          if (ix.i % 10 === 0) notify();
          return sleep(BATCH_WAIT).then(next);
        });
      }
      return C.dropVecs(gone).then(next);
    }).catch(function () { /* the next open tries again */ }).then(function () {
      if (gen === ix.gen) ix.running = false;
      notify();
    });
  }

  // ---------- searching ----------
  var current = null;     // { kind: "text"|"similar", vec, q, shown, failed, name }
  function runRank() {
    var C = clip();
    if (!C || !current) return Promise.resolve();
    var cur = current;
    return C.vecs().then(function (list) {
      if (cur !== current) return;
      var byKey = {};
      candidates().forEach(function (r) { byKey[api.thumbKey(r)] = r; });
      var opts = cur.kind === "similar" ? { min: 0.75, spread: 0.2, max: 300 } : {};
      var hits = CORE.rank(cur.vec, list.filter(function (x) { return byKey[x.k] && x.k !== cur.self; }), opts);
      var keys = hits.map(function (h) { return byKey[h.k].k; });
      var notes = [];
      if (cur.shown) notes.push(t("ps.translated", { q: cur.shown }));
      if (cur.failed) notes.push(t("ps.notTranslated"));
      if (ix.running && ix.i < ix.n) notes.push(t("ps.partial", { i: ix.i, n: ix.n }));
      else if (!keys.length) notes.push(t("ps.none"));
      var title = cur.kind === "similar" ? t("ps.similarTo", { name: cur.name }) : t("ps.results", { q: cur.q });
      api.show(title, keys, notes.join(" "), function () { current = null; });
    });
  }
  // While the index grows, the open result list follows it.
  var rerankTimer = 0;
  listeners.push(function () {
    if (!current || rerankTimer) return;
    rerankTimer = setTimeout(function () { rerankTimer = 0; runRank(); }, ix.running ? 4000 : 0);
  });

  function search(q) {
    var C = clip();
    return toEnglish(q).then(function (en) {
      return C.embedText(en.q).then(function (vec) {
        current = { kind: "text", vec: vec, q: q, shown: en.shown, failed: en.failed };
        startIndex();
        return runRank();
      });
    });
  }
  function similar(r) {
    var C = clip();
    return C.ready().then(function (ok) {
      if (!ok) return open();
      var key = api.thumbKey(r);
      return thumbFor(r).then(function (b) {
        if (!b) throw new Error("thumb");
        return C.embedImage(b);
      }).then(function (vec) {
        current = { kind: "similar", vec: vec, name: api.baseName(r.k), self: key };
        startIndex();
        return runRank();
      }).catch(function () { api.toast(t("ps.engine")); });
    });
  }

  // ---------- the dialog ----------
  function errText(e) {
    var c = e && e.code;
    return c === "hash" ? t("ps.hash") : c === "quota" ? t("ps.quota") : c === "engine" ? t("ps.engine") : t("ps.failed");
  }
  function statusLine(box) {
    function paint() {
      if (!box.isConnected) return;
      box.textContent = "";
      if (ix.n && ix.i < ix.n) box.textContent = t("ps.indexing", { i: ix.i, n: ix.n });
      else if (ix.n) box.textContent = t("ps.indexed", { n: ix.n });
      if (ix.cloudLeft) box.textContent += " " + t("ps.waitCloud", { n: ix.cloudLeft });
    }
    listeners.push(paint);
    paint();
    return function () { var i = listeners.indexOf(paint); if (i >= 0) listeners.splice(i, 1); };
  }

  function open() {
    var C = clip();
    if (!C) return Promise.resolve();
    return C.ready().then(function (ok) {
      var d = el("dialog", "ph-dlg ps-dlg");
      d.setAttribute("aria-label", t("ps.title"));
      var f = el("form");
      f.method = "dialog";
      f.appendChild(el("h2", "ps-title", t("ps.title")));
      var detach = function () {};
      var body = el("div", "ps-body");
      f.appendChild(body);
      var row = el("menu", "dlg-row");
      var no = el("button", "", t("ps.cancel"));
      no.type = "button";
      no.addEventListener("click", function () { d.close(); });
      row.appendChild(no);
      f.appendChild(row);
      d.appendChild(f);
      document.body.appendChild(d);
      d.addEventListener("close", function () { detach(); d.remove(); });

      function searchForm() {
        body.textContent = "";
        var lab = el("label", "ps-label", t("ps.label"));
        var inp = el("input", "ps-input");
        inp.type = "search";
        inp.id = "ps-q";
        inp.maxLength = 200;
        inp.autocomplete = "off";
        inp.placeholder = t("ps.hint");
        lab.htmlFor = "ps-q";
        body.appendChild(lab);
        body.appendChild(inp);
        var st = el("p", "ps-status");
        st.setAttribute("role", "status");
        body.appendChild(st);
        detach = statusLine(st);
        var go = el("button", "primary", t("ps.go"));
        go.type = "submit";
        row.appendChild(go);
        f.onsubmit = function (e) {
          e.preventDefault();
          var q = inp.value.trim();
          if (!q) { inp.focus(); return; }
          go.disabled = true;
          search(q).then(function () { d.close(); }, function (er) { go.disabled = false; st.textContent = errText(er); });
        };
        startIndex();
        setTimeout(function () { inp.focus(); }, 0);
      }

      if (ok) { searchForm(); d.showModal(); return; }
      langMb().then(function (gmb) {
        body.appendChild(el("p", "", t("ps.intro", { mb: C.MB })));
        var wantGreek = gmb > 0;
        if (wantGreek) body.appendChild(el("p", "", t("ps.introEl", { mb: gmb })));
        var prog = el("p", "ps-status");
        prog.setAttribute("role", "status");
        body.appendChild(prog);
        var dl = el("button", "primary", t("ps.download"));
        dl.type = "button";
        row.appendChild(dl);
        var cancelled = false;
        d.addEventListener("close", function () { cancelled = true; });
        dl.addEventListener("click", function () {
          dl.disabled = true;
          var share = wantGreek ? 0.85 : 1;
          C.install(function (p) { prog.textContent = t("ps.downloading", { p: Math.round(p * share * 100) }); }, function () { return cancelled; })
            .then(function () {
              if (!wantGreek) return;
              return translator().then(function (tr) {
                if (!tr) return;
                return tr.install(LANG, "en", {
                  progress: function (p) { prog.textContent = t("ps.downloading", { p: Math.round((share + p * (1 - share)) * 100) }); },
                  cancelled: function () { return cancelled; }
                }).catch(function () { /* searches in Greek say so */ });
              });
            })
            .then(function () { setOn(true); if (cancelled) return; dl.remove(); searchForm(); },
                  function (e) { if (cancelled) return; dl.disabled = false; prog.textContent = errText(e); });
        });
        d.showModal();
        dl.focus();
      });
    });
  }

  function manage() {
    var C = clip();
    if (!C) return;
    C.ready().then(function (ok) {
      if (!ok) { open(); return; }
      C.count().then(function (n) {
        var d = el("dialog", "ph-dlg ps-dlg");
        var f = el("div");
        f.appendChild(el("h2", "ps-title", t("ps.title")));
        f.appendChild(el("p", "", t("ps.status", { n: n })));
        var row = el("menu", "dlg-row");
        var no = el("button", "", t("ps.cancel"));
        no.type = "button";
        no.addEventListener("click", function () { d.close(); });
        var rm = el("button", "danger", t("ps.remove"));
        rm.type = "button";
        rm.addEventListener("click", function () {
          d.close();
          api.confirm(t("ps.removeAsk", { mb: C.MB }), t("ps.remove")).then(function (yes) {
            if (!yes) return;
            ix.gen++; ix.running = false; ix.n = 0; ix.i = 0;
            if (current) { current = null; api.show(null); }
            setOn(false);
            C.remove().then(function () { api.toast(t("ps.removed")); });
          });
        });
        row.appendChild(no); row.appendChild(rm);
        f.appendChild(row);
        d.appendChild(f);
        document.body.appendChild(d);
        d.addEventListener("close", function () { d.remove(); });
        d.showModal();
        no.focus();
      });
    });
  }

  function stop() { ix.gen++; ix.running = false; current = null; }

  window.OrosPhotoSearch = {
    attach: function (a) { api = a; },
    open: open,
    similar: similar,
    manage: manage,
    stop: stop,
    resume: function () { var C = clip(); if (C) C.ready().then(function (ok) { if (ok) startIndex(); }); },
    t: t
  };
})();
