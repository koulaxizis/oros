// ============================================================
// orOS captions — caption/ui.js (CAPTION v1, the shared flow)
// ------------------------------------------------------------
// One "describe this picture" flow for every app (Photos, Writer,
// Layout): loads the engine the first time (../modelfetch.js,
// caption/core.js, caption/caption.js, ../translate/engine.js, all
// from this site), asks before the one-time model download (the app
// shows the question in its own dialog), reports progress, and
// returns a suggestion in the app's language. A suggestion is never
// written anywhere by this file: the app puts it in an edit field and
// the person saves it.
//   OrosCaptionUI.suggest(blob, {
//     lang,                       "en" | "el" | "de" … (default orosI18n)
//     task,                       "short" (alt text) | "detail"
//     confirm(text, okLabel, cancelLabel) → Promise<bool>  the app's dialog
//     status(text),               progress line for the app to show
//     cancelled()                 → true stops a download
//   }) → Promise<{ text, en, lang, translated, note } | null (said no)>
//   OrosCaptionUI.failText(error, lang) → a sentence for a toast
//   OrosCaptionUI.t(key, lang, vars)   → this file's strings (en, el, de)
//   OrosCaptionUI.engine()     → Promise<OrosCaption> (loaded)
// ============================================================
(function (root) {
  "use strict";

  var DIR = (function () {
    var s = document.currentScript, src = (s && s.src) || "";
    return src ? src.replace(/[?#].*$/, "").replace(/[^/]*$/, "") : "../caption/";
  })();
  var V = (function () {
    var s = document.currentScript, m = s && /\?v=[^#]*/.exec(s.src || "");
    return m ? m[0] : "";
  })();

  var STRINGS = {
    en: {
      ask: "orOS describes pictures on this device. It needs a model of about {mb} MB, downloaded once from our own copy on GitHub Pages. Your pictures never leave this device. Download it now?",
      askOk: "Download",
      askNo: "Cancel",
      getting: "Downloading the description model… {p}%",
      working: "Describing… (this can take up to half a minute)",
      check: "Suggested on this device. Check it and correct it before you save.",
      english: "In English: the translation into your language is not on this device yet (Text Tools › Translate).",
      fail: "The description could not be made.",
      failGet: "The model could not be downloaded. Check the connection and try again.",
      failRoom: "There is not enough room on this device for the model.",
      failImage: "This picture could not be read."
    },
    el: {
      ask: "Το orOS περιγράφει τις εικόνες σε αυτή τη συσκευή. Χρειάζεται ένα μοντέλο περίπου {mb} MB, που κατεβαίνει μία φορά από το δικό μας αντίγραφο στο GitHub Pages. Οι εικόνες σου δεν φεύγουν ποτέ από τη συσκευή. Να γίνει η λήψη τώρα;",
      askOk: "Λήψη",
      askNo: "Άκυρο",
      getting: "Λήψη του μοντέλου περιγραφής… {p}%",
      working: "Γράφεται η περιγραφή… (μπορεί να πάρει έως μισό λεπτό)",
      check: "Πρόταση από αυτή τη συσκευή. Έλεγξέ την και διόρθωσέ την πριν την αποθηκεύσεις.",
      english: "Στα αγγλικά: η μετάφραση στη γλώσσα σου δεν υπάρχει ακόμα σε αυτή τη συσκευή (Εργαλεία κειμένου › Μετάφραση).",
      fail: "Η περιγραφή δεν μπόρεσε να γίνει.",
      failGet: "Η λήψη του μοντέλου απέτυχε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      failRoom: "Δεν υπάρχει αρκετός χώρος σε αυτή τη συσκευή για το μοντέλο.",
      failImage: "Αυτή η εικόνα δεν διαβάστηκε."
    },
    de: {
      ask: "orOS beschreibt Bilder auf diesem Gerät. Dafür braucht es ein Modell von etwa {mb} MB, das einmal von unserer eigenen Kopie auf GitHub Pages geladen wird. Deine Bilder verlassen dieses Gerät nie. Jetzt herunterladen?",
      askOk: "Herunterladen",
      askNo: "Abbrechen",
      getting: "Das Beschreibungsmodell wird geladen… {p}%",
      working: "Wird beschrieben… (das kann bis zu einer halben Minute dauern)",
      check: "Auf diesem Gerät vorgeschlagen. Prüfe und korrigiere ihn, bevor du speicherst.",
      english: "Auf Englisch: Die Übersetzung in deine Sprache ist noch nicht auf diesem Gerät (Textwerkzeuge › Übersetzen).",
      fail: "Die Beschreibung konnte nicht erstellt werden.",
      failGet: "Das Modell konnte nicht geladen werden. Prüfe die Verbindung und versuche es erneut.",
      failRoom: "Auf diesem Gerät ist nicht genug Platz für das Modell.",
      failImage: "Dieses Bild konnte nicht gelesen werden."
    }
  };
  function uiLang(l) {
    if (!l && root.orosI18n && typeof root.orosI18n.lang === "function") { try { l = root.orosI18n.lang(); } catch (e) { l = ""; } }
    return l || "en";
  }
  function t(k, lang, vars) {
    var tb = STRINGS[uiLang(lang)] || STRINGS.en, s = tb[k] || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var SCRIPTS = ["../modelfetch.js", "core.js", "caption.js", "../translate/engine.js"], engineP = null;
  function engine() {
    if (root.OrosCaption && root.OrosTranslate) return Promise.resolve(root.OrosCaption);
    if (!engineP) {
      engineP = SCRIPTS.reduce(function (p, src) {
        return p.then(function () {
          var want = src === "../modelfetch.js" ? root.OrosModelFetch : src === "core.js" ? root.OrosCaptionCore :
            src === "caption.js" ? root.OrosCaption : root.OrosTranslate;
          if (want) return null;
          return new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = DIR + src + V;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error("load")); };
            document.head.appendChild(s);
          });
        });
      }, Promise.resolve()).then(function () {
        if (!root.OrosCaption) throw new Error("load");
        return root.OrosCaption;
      });
      engineP.catch(function () { engineP = null; });
    }
    return engineP;
  }

  function suggest(blob, o) {
    o = o || {};
    var lang = uiLang(o.lang), status = o.status || function () {};
    status(t("working", lang));
    return engine().then(function (C) {
      return C.ready().then(function (on) {
        if (on) return C;
        var ask = o.confirm ? o.confirm(t("ask", lang, { mb: C.MB }), t("askOk", lang), t("askNo", lang))
                            : Promise.resolve(root.confirm(t("ask", lang, { mb: C.MB })));
        return ask.then(function (yes) {
          if (!yes) return null;
          status(t("getting", lang, { p: 0 }));
          return C.install(function (f) { status(t("getting", lang, { p: Math.round(f * 100) })); }, o.cancelled)
            .then(function () { status(t("working", lang)); return C; });
        });
      });
    }).then(function (C) {
      if (!C) return null;
      return C.describeIn(blob, lang, { task: o.task }).then(function (r) {
        var note = t("check", lang);
        if (lang !== "en" && !r.translated) note += " " + t("english", lang);
        return { text: r.text, en: r.en, lang: r.lang, translated: r.translated, note: note };
      });
    });
  }
  function failText(e, lang) {
    var c = e && e.code;
    if (c === "quota") return t("failRoom", lang);
    if (c === "download" || c === "hash") return t("failGet", lang);
    if (c === "image") return t("failImage", lang);
    return t("fail", lang);
  }

  root.OrosCaptionUI = { suggest: suggest, failText: failText, t: t, engine: engine, STRINGS: STRINGS };
})(typeof window !== "undefined" ? window : this);
