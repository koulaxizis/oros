// ============================================================
// orOS Files — photo-caption.js (CAPTION v1, the Photos screen part)
// ------------------------------------------------------------
// A photo's description in the viewer's Details panel: the person
// writes it, or asks the device to suggest one (caption/caption.js,
// Florence-2, on the device; translated with translate/engine.js when
// that language's model is installed). A suggestion is never saved by
// itself: it opens in the edit box, the person checks it and saves.
// Saved descriptions are the synced slice "files-captions"
// (captions-core.js) and Files' search finds photos by them.
// The model (~275 MB) downloads only after the person said yes to a
// dialog that shows the size (caption/ui.js, the flow every app shares);
// "Remove the description model" frees it.
// files.js loads this file with captions-core.js and ../caption/ui.js;
// photos.js calls
//   OrosPhotoCaption.init({ toast })
//   OrosPhotoCaption.section(rec, getBlob) → <div> for the Details panel
//     rec = { k: path, h: sha256?, kind }, getBlob() → Promise<Blob>
//   OrosPhotoCaption.textOf(rec) → the saved description ("" if none)
// ============================================================
(function () {
  "use strict";

  var CORE = window.OrosCaptionsCore;
  if (!CORE) return;
  var LANG = (function () {
    if (window.orosI18n) return window.orosI18n.lang();
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var STRINGS = {
    en: {
      "cap.title":    "Description",
      "cap.none":     "No description yet.",
      "cap.suggest":  "Describe automatically",
      "cap.edit":     "Edit",
      "cap.write":    "Write a description",
      "cap.save":     "Save",
      "cap.cancel":   "Cancel",
      "cap.remove":   "Remove",
      "cap.label":    "Description of this photo",
      "cap.drop":     "Remove the description model ({mb} MB)",
      "cap.dropped":  "The description model was removed from this device.",
      "cap.saved":    "Description saved",
      "cap.saveFail": "The description could not be saved on this device."
    },
    el: {
      "cap.title":    "Περιγραφή",
      "cap.none":     "Δεν υπάρχει περιγραφή ακόμα.",
      "cap.suggest":  "Αυτόματη περιγραφή",
      "cap.edit":     "Επεξεργασία",
      "cap.write":    "Γράψε περιγραφή",
      "cap.save":     "Αποθήκευση",
      "cap.cancel":   "Άκυρο",
      "cap.remove":   "Αφαίρεση",
      "cap.label":    "Περιγραφή αυτής της φωτογραφίας",
      "cap.drop":     "Αφαίρεση του μοντέλου περιγραφής ({mb} MB)",
      "cap.dropped":  "Το μοντέλο περιγραφής αφαιρέθηκε από αυτή τη συσκευή.",
      "cap.saved":    "Η περιγραφή αποθηκεύτηκε",
      "cap.saveFail": "Η περιγραφή δεν αποθηκεύτηκε σε αυτή τη συσκευή."
    }
  };
  if (window.orosI18n && window.orosI18n.table) window.orosI18n.table(STRINGS, "files", LANG);
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
  function btn(cls, text, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  var ctx = {}, state = CORE.norm(null), busy = false;

  // ---------- storage + sync (slice "files-captions") ----------
  function syncApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(CORE.KEY)); } catch (e) { raw = null; }
    state = CORE.norm(raw);
  }
  function commit(next) {
    if (next === state) return true;
    state = next;
    var ok = true;
    try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); }
    catch (e) { ok = false; toast(t("cap.saveFail")); }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    return ok;
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice(CORE.SLICE, function () {
      return CORE.norm(state);
    }, function (incoming) {
      // R6: a pull never marks dirty.
      var next = CORE.norm(incoming);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); } catch (e) {}
      if (ctx.onChange) ctx.onChange();
    }, CORE.KEY, CORE.merge);
  }
  function toast(s) { if (ctx.toast) ctx.toast(s); }

  // ---------- the engine (caption/ui.js loads it the first time) ----------
  var UI = window.OrosCaptionUI;
  function loadEngine() { return UI ? UI.engine() : Promise.reject(new Error("load")); }
  function askDownload(text, okText, noText) {
    return new Promise(function (resolve) {
      var d = el("dialog", "ph-dlg"), f = el("div");
      f.appendChild(el("p", "", text));
      var row = el("menu", "dlg-row");
      var no = btn("", noText, function () { d.close(); });
      var yes = btn("primary", okText, function () { d.close("yes"); });
      row.appendChild(no); row.appendChild(yes);
      f.appendChild(row);
      d.appendChild(f);
      document.body.appendChild(d);
      d.addEventListener("close", function () { resolve(d.returnValue === "yes"); d.remove(); });
      d.showModal();
      yes.focus();
    });
  }

  // ---------- the Details section ----------
  function textOf(rec) { return rec ? CORE.textOf(state, rec.k, rec.h || "") : ""; }

  function section(rec, getBlob) {
    var box = el("div", "ph-irow ph-cap");
    box.appendChild(el("span", "k", t("cap.title")));
    var body = el("div", "ph-cap-body");
    box.appendChild(body);
    var gone = false;
    function alive() { return !gone && box.isConnected; }

    function show() {
      body.innerHTML = "";
      var cur = textOf(rec);
      body.appendChild(el("p", cur ? "v ph-cap-text" : "v ph-cap-none", cur || t("cap.none")));
      var row = el("div", "ph-cap-row");
      if (UI && rec.kind === "image" && window.Worker && window.indexedDB) row.appendChild(btn("ph-cap-btn", t("cap.suggest"), suggest));
      row.appendChild(btn("ph-cap-btn", cur ? t("cap.edit") : t("cap.write"), function () { edit(cur, ""); }));
      body.appendChild(row);
      if (window.OrosCaption) {
        window.OrosCaption.ready().then(function (on) {
          if (!on || !alive()) return;
          var drop = btn("ph-cap-link", t("cap.drop", { mb: window.OrosCaption.MB }), function () {
            window.OrosCaption.remove().then(function () { toast(t("cap.dropped")); if (alive()) show(); });
          });
          body.appendChild(drop);
        });
      }
    }
    function edit(text, note) {
      body.innerHTML = "";
      var ta = el("textarea", "ph-cap-ta");
      ta.value = text || "";
      ta.rows = 4;
      ta.maxLength = CORE.MAX_TEXT;
      ta.setAttribute("aria-label", t("cap.label"));
      body.appendChild(ta);
      if (note) body.appendChild(el("p", "ph-cap-note", note));
      var row = el("div", "ph-cap-row");
      row.appendChild(btn("ph-cap-btn primary", t("cap.save"), function () { save(ta.value); }));
      row.appendChild(btn("ph-cap-btn", t("cap.cancel"), show));
      if (textOf(rec)) row.appendChild(btn("ph-cap-btn", t("cap.remove"), function () { save(""); }));
      body.appendChild(row);
      ta.focus();
    }
    function save(text) {
      var next = CORE.set(state, rec.k, rec.h || "", text, Date.now());
      if (commit(next) && next !== state) toast(t("cap.saved"));
      else if (next === state && CORE.cleanText(text) === textOf(rec)) toast(t("cap.saved"));
      if (ctx.onChange) ctx.onChange();
      if (alive()) show();
    }
    function status(s) {
      body.innerHTML = "";
      var p = el("p", "v ph-cap-wait", s);
      p.setAttribute("role", "status");
      body.appendChild(p);
      return p;
    }
    function suggest() {
      if (busy || !UI) return;
      busy = true;
      var line = status("");
      getBlob().then(function (blob) {
        return UI.suggest(blob, { lang: LANG, task: "short", confirm: askDownload,
          status: function (s) { if (line) line.textContent = s; }, cancelled: function () { return !alive(); } });
      }).then(function (r) {
        busy = false;
        if (!alive()) return;
        if (!r) { show(); return; }
        edit(r.text, r.note);
      }, function (e) {
        busy = false;
        if (e && e.code === "cancelled") return;
        toast(UI.failText(e, LANG));
        if (alive()) show();
      });
    }
    show();
    return box;
  }

  function init(c) {
    ctx = c || {};
    load();
    registerSync();
  }

  window.OrosPhotoCaption = { init: init, section: section, textOf: textOf, loadEngine: loadEngine };
})();
