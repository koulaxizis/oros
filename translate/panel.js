// ============================================================
// orOS — Translate panel (TRANSLATE wave T3)
// One small dialog that Mail, Reader, Notes and Montage open from their
// own Translate button. It loads ../translate/engine.js on first use and
// translates on the device exactly as Text Tools does: same models, same
// downloads (asked first, with the size), same "through English" routes,
// the Assistant's AI only where no model fits and only when the person
// turned that on (oros-translate-prefs, Settings › Translation).
//
// window.OrosTranslatePanel.open(opts)
//   opts.text      a plain text, or
//   opts.segments  [string] (Montage: one per subtitle, order kept)
//   opts.lang      UI language "en" | "el" | "de" (default orosI18n)
//   opts.actions   [{ label, run(result) }]  result = { text } or
//                  { segments: [string] }; the panel closes after run
//                  (Copy is always there for a text)
// Nothing is stored except the last "To" language (device-local
// "oros-translate-panel" { to }). Translations are shown only through
// textContent / textarea.value.
// ============================================================
(function (root) {
  "use strict";
  var doc = root.document;
  var BASE = (function () {
    var src = (doc && doc.currentScript && doc.currentScript.src) || "";
    var v = /[?](v=[^#]*)/.exec(src);
    return { dir: src ? src.replace(/[^/]*$/, "") : "../translate/", q: v ? "?" + v[1] : "" };
  })();
  var PREF_KEY = "oros-translate-panel";

  var STR = {
    en: {
      title: "Translate", from: "From", to: "To", auto: "Detect", swap: "Swap the languages",
      hint: "Translates on this device with Mozilla's models. The text does not leave the device.",
      detected: "Language: {lang}.", need: "{a} → {b} needs a download of about {mb} MB, only the first time.",
      nopair: "There is no model for these languages yet.", viaAi: "No model for these languages: the Assistant's AI ({name}) translates them, so the text leaves the device.",
      viaAiNone: "No model for these languages, and no AI is set up in the Assistant.",
      go: "Translate", getGo: "Download ({mb} MB) and translate", goAi: "Translate with the AI", stop: "Stop",
      downloading: "Downloading… {p}%", working: "Translating… {p}%", done: "Translated on this device ({a} → {b})",
      doneAi: "Translated by {name} ({a} → {b})", same: "The text is already in {lang}", empty: "There is no text to translate",
      segs: "{n} lines", copy: "Copy", copied: "Copied", close: "Close", result: "Translation",
      loading: "Loading the translator…",
      "err.unsupported": "This browser cannot translate on the device", "err.download": "The download failed. Check the connection and try again.",
      "err.hash": "A downloaded file was damaged, so nothing was kept. Try again.", "err.quota": "There is not enough space on this device",
      "err.pair": "There is no model for these languages yet", "err.cancelled": "Stopped", "err.engine": "The translation stopped with an error",
      "err.ai-off": "The Assistant's AI is off for translation", "err.ai-none": "Set up an AI in the Assistant first",
      "err.ai": "The Assistant's AI did not answer. Try again later.", "err.load": "The translator could not be loaded"
    },
    el: {
      title: "Μετάφραση", from: "Από", to: "Προς", auto: "Αυτόματα", swap: "Αντιστροφή γλωσσών",
      hint: "Μεταφράζει μέσα στη συσκευή με τα μοντέλα της Mozilla. Το κείμενο δεν φεύγει από τη συσκευή.",
      detected: "Γλώσσα: {lang}.", need: "Για {a} → {b} χρειάζεται λήψη περίπου {mb} MB, μόνο την πρώτη φορά.",
      nopair: "Δεν υπάρχει ακόμη μοντέλο για αυτές τις γλώσσες.", viaAi: "Δεν υπάρχει μοντέλο για αυτές τις γλώσσες: θα μεταφράσει η AI του Βοηθού ({name}), οπότε το κείμενο φεύγει από τη συσκευή.",
      viaAiNone: "Δεν υπάρχει μοντέλο για αυτές τις γλώσσες, ούτε AI ρυθμισμένη στον Βοηθό.",
      go: "Μετάφραση", getGo: "Λήψη ({mb} MB) και μετάφραση", goAi: "Μετάφραση με την AI", stop: "Διακοπή",
      downloading: "Λήψη… {p}%", working: "Μετάφραση… {p}%", done: "Μεταφράστηκε στη συσκευή ({a} → {b})",
      doneAi: "Μεταφράστηκε από {name} ({a} → {b})", same: "Το κείμενο είναι ήδη στα {lang}", empty: "Δεν υπάρχει κείμενο για μετάφραση",
      segs: "{n} γραμμές", copy: "Αντιγραφή", copied: "Αντιγράφηκε", close: "Κλείσιμο", result: "Μετάφραση",
      loading: "Φόρτωση του μεταφραστή…",
      "err.unsupported": "Αυτός ο browser δεν μπορεί να μεταφράσει μέσα στη συσκευή", "err.download": "Η λήψη απέτυχε. Έλεγξε τη σύνδεση και ξαναδοκίμασε.",
      "err.hash": "Ένα αρχείο ήρθε χαλασμένο, οπότε δεν κρατήθηκε τίποτα. Ξαναδοκίμασε.", "err.quota": "Δεν υπάρχει αρκετός χώρος στη συσκευή",
      "err.pair": "Δεν υπάρχει ακόμη μοντέλο για αυτές τις γλώσσες", "err.cancelled": "Σταμάτησε", "err.engine": "Η μετάφραση σταμάτησε με σφάλμα",
      "err.ai-off": "Η AI του Βοηθού είναι κλειστή για μετάφραση", "err.ai-none": "Ρύθμισε πρώτα μια AI στον Βοηθό",
      "err.ai": "Η AI του Βοηθού δεν απάντησε. Ξαναδοκίμασε αργότερα.", "err.load": "Ο μεταφραστής δεν φορτώθηκε"
    },
    de: {
      title: "Übersetzen", from: "Von", to: "Nach", auto: "Erkennen", swap: "Sprachen tauschen",
      hint: "Übersetzt auf diesem Gerät mit den Modellen von Mozilla. Der Text verlässt das Gerät nicht.",
      detected: "Sprache: {lang}.", need: "{a} → {b} braucht einmal einen Download von etwa {mb} MB.",
      nopair: "Für diese Sprachen gibt es noch kein Modell.", viaAi: "Kein Modell für diese Sprachen: Die KI des Assistenten ({name}) übersetzt sie, der Text verlässt also das Gerät.",
      viaAiNone: "Kein Modell für diese Sprachen, und im Assistenten ist keine KI eingerichtet.",
      go: "Übersetzen", getGo: "Laden ({mb} MB) und übersetzen", goAi: "Mit der KI übersetzen", stop: "Stopp",
      downloading: "Wird geladen… {p} %", working: "Wird übersetzt… {p} %", done: "Auf diesem Gerät übersetzt ({a} → {b})",
      doneAi: "Übersetzt von {name} ({a} → {b})", same: "Der Text ist schon auf {lang}", empty: "Es gibt keinen Text zum Übersetzen",
      segs: "{n} Zeilen", copy: "Kopieren", copied: "Kopiert", close: "Schließen", result: "Übersetzung",
      loading: "Der Übersetzer wird geladen…",
      "err.unsupported": "Dieser Browser kann nicht auf dem Gerät übersetzen", "err.download": "Der Download ist fehlgeschlagen. Prüfe die Verbindung und versuche es noch einmal.",
      "err.hash": "Eine geladene Datei war beschädigt, daher wurde nichts behalten. Versuche es noch einmal.", "err.quota": "Auf diesem Gerät ist nicht genug Platz",
      "err.pair": "Für diese Sprachen gibt es noch kein Modell", "err.cancelled": "Gestoppt", "err.engine": "Die Übersetzung wurde mit einem Fehler beendet",
      "err.ai-off": "Die KI des Assistenten ist für Übersetzungen aus", "err.ai-none": "Richte zuerst eine KI im Assistenten ein",
      "err.ai": "Die KI des Assistenten hat nicht geantwortet. Versuche es später noch einmal.", "err.load": "Der Übersetzer konnte nicht geladen werden"
    }
  };

  var CSS = ".otp{border:1px solid var(--border,#8884);border-radius:12px;background:var(--panel-bg,var(--bg,#fff));color:var(--text,inherit);" +
    "padding:16px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);box-sizing:border-box;box-shadow:var(--shadow,0 8px 30px #0004)}" +
    ".otp::backdrop{background:#0006}.otp h2{margin:0 0 6px;font-size:1.1em}.otp .otp-hint{margin:0 0 10px;color:var(--text-dim,inherit);font-size:.88em}" +
    ".otp .otp-langs{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}.otp label{display:flex;flex-direction:column;gap:3px;font-size:.85em;flex:1 1 140px;min-width:0}" +
    ".otp select{font:inherit;padding:6px;border:1px solid var(--border,#8884);border-radius:8px;background:var(--bg,transparent);color:inherit;min-width:0}" +
    ".otp button{font:inherit;padding:7px 12px;border:1px solid var(--border,#8884);border-radius:8px;background:transparent;color:inherit;cursor:pointer;min-height:36px}" +
    ".otp button.otp-pri{background:var(--accent,#3b6);border-color:var(--accent,#3b6);color:var(--accent-ink,#fff)}.otp button:disabled{opacity:.5;cursor:default}" +
    ".otp .otp-swap{flex:0 0 auto;padding:7px 10px}.otp .otp-info{min-height:1.2em;margin:10px 0 8px;font-size:.88em;color:var(--text-dim,inherit)}" +
    ".otp .otp-info.err{color:var(--danger,#c33)}.otp textarea{width:100%;box-sizing:border-box;min-height:150px;max-height:45vh;font:inherit;padding:8px;" +
    "border:1px solid var(--border,#8884);border-radius:8px;background:var(--bg,transparent);color:inherit;resize:vertical}" +
    ".otp .otp-acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:10px}";

  function lang(o) {
    var l = o && o.lang;
    if (!l && root.orosI18n && typeof root.orosI18n.lang === "function") { try { l = root.orosI18n.lang(); } catch (e) { l = ""; } }
    return STR[l] ? l : "en";
  }
  function fmt(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function readPref() {
    try { var p = JSON.parse(root.localStorage.getItem(PREF_KEY)); return p && typeof p === "object" ? p : {}; } catch (e) { return {}; }
  }
  function writePref(p) { try { root.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }

  var loading = null;
  function engine() {
    if (root.OrosTranslate) return Promise.resolve(root.OrosTranslate);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = doc.createElement("script");
        s.src = BASE.dir + "engine.js" + BASE.q;
        s.onload = function () { if (root.OrosTranslate) resolve(root.OrosTranslate); else reject(new Error("load")); };
        s.onerror = function () { reject(new Error("load")); };
        doc.head.appendChild(s);
      }).then(null, function (e) { loading = null; throw e; });
    }
    return loading;
  }
  function css() {
    if (doc.getElementById("otp-css")) return;
    var s = el("style");
    s.id = "otp-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function copyText(s) {
    try { if (root.navigator.clipboard && root.navigator.clipboard.writeText) return root.navigator.clipboard.writeText(s); } catch (e) {}
    return new Promise(function (resolve, reject) {
      var ta = el("textarea");
      ta.value = s;
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e2) {}
      ta.remove();
      if (ok) resolve(); else reject(new Error("copy"));
    });
  }

  // The "To" language the panel starts with: the last one used, else the
  // UI language, else English; never the language the text is in.
  function startTo(TR, ui, detected) {
    var tos = TR.tos(), p = readPref(), want = [p.to, ui, "en", "el"];
    for (var i = 0; i < want.length; i++) {
      if (want[i] && tos.indexOf(want[i]) >= 0 && want[i] !== detected) return want[i];
    }
    return tos[0];
  }

  function open(opts) {
    opts = opts || {};
    var L = lang(opts), S = STR[L];
    function t(k, v) { return fmt(S[k] != null ? S[k] : STR.en[k] != null ? STR.en[k] : k, v); }
    var segs = Array.isArray(opts.segments) ? opts.segments.map(function (x) { return String(x == null ? "" : x); }) : null;
    var text = segs ? segs.join("\n") : String(opts.text == null ? "" : opts.text);
    css();
    var old = doc.getElementById("otp");
    if (old) { try { old.close(); } catch (e) {} old.remove(); }
    var dlg = el("dialog", "otp");
    dlg.id = "otp";
    dlg.setAttribute("aria-labelledby", "otp-h");
    var h = el("h2", "", t("title"));
    h.id = "otp-h";
    dlg.appendChild(h);
    var hint = el("p", "otp-hint", t("hint"));
    dlg.appendChild(hint);
    var info = el("p", "otp-info", t("loading"));
    info.setAttribute("aria-live", "polite");
    var st = { busy: false, stop: false, res: null, ai: null, status: null };
    var closeBtn = el("button", "", t("close"));
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () { st.stop = true; dlg.close(); });
    dlg.addEventListener("close", function () { st.stop = true; dlg.remove(); });
    doc.body.appendChild(dlg);
    var acts = el("div", "otp-acts");
    acts.appendChild(closeBtn);
    dlg.appendChild(info);
    dlg.appendChild(acts);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }

    engine().then(function (TR) { build(TR); }, function () {
      info.textContent = t("err.load");
      info.className = "otp-info err";
    });

    function build(TR) {
      var detected = TR.detect(text);
      var from = "auto", to = startTo(TR, L, detected);
      function nm(c) { return TR.name(c, L); }
      function fromCode() { return from === "auto" ? TR.detect(text) : from; }
      function sorted(list) { return list.slice().sort(function (a, b) { return nm(a).localeCompare(nm(b), L); }); }
      function select(list, val, withAuto, onChange) {
        var s = el("select");
        (withAuto ? ["auto"] : []).concat(sorted(list)).forEach(function (c) {
          var o = el("option", "", c === "auto" ? t("auto") : nm(c));
          o.value = c;
          s.appendChild(o);
        });
        s.value = val;
        s.addEventListener("change", function () { onChange(s.value); });
        return s;
      }
      var row = el("div", "otp-langs");
      var lf = el("label", "", t("from")), lt = el("label", "", t("to"));
      var sf = select(TR.froms(), from, true, function (v) {
        from = v;
        if (fromCode() === to) { to = startTo(TR, L, fromCode()); st_to.value = to; }
        refresh();
      });
      var st_to = select(TR.tos(), to, false, function (v) {
        to = v;
        var p = readPref(); p.to = v; writePref(p);
        refresh();
      });
      lf.appendChild(sf);
      lt.appendChild(st_to);
      var swap = el("button", "otp-swap", "⇄");
      swap.type = "button";
      swap.title = t("swap");
      swap.setAttribute("aria-label", t("swap"));
      swap.addEventListener("click", function () {
        var f = fromCode();
        if (st.busy || TR.tos().indexOf(f) < 0 || TR.froms().indexOf(to) < 0) return;
        from = to; to = f;
        sf.value = from; st_to.value = to;
        refresh();
      });
      row.appendChild(lf); row.appendChild(swap); row.appendChild(lt);
      dlg.insertBefore(row, info);
      var out = el("textarea");
      out.readOnly = true;
      out.setAttribute("aria-label", t("result"));
      out.hidden = true;
      dlg.insertBefore(out, acts);
      var go = el("button", "otp-pri");
      go.type = "button";
      go.addEventListener("click", run);
      var copy = el("button", "", t("copy"));
      copy.type = "button";
      copy.hidden = true;
      copy.addEventListener("click", function () {
        if (!st.res) return;
        copyText(st.res.text).then(function () { copy.textContent = t("copied"); }, function () {});
      });
      acts.insertBefore(copy, closeBtn);
      var own = (opts.actions || []).filter(function (a) { return a && typeof a.run === "function"; }).map(function (a) {
        var b = el("button", "", String(a.label || ""));
        b.type = "button";
        b.hidden = true;
        b.addEventListener("click", function () {
          if (!st.res) return;
          var r = st.res;
          dlg.close();
          a.run(segs ? { segments: r.segments } : { text: r.text });
        });
        acts.insertBefore(b, closeBtn);
        return b;
      });
      acts.appendChild(go);

      function showDone(on) {
        out.hidden = !on;
        copy.hidden = !on || !!segs;
        own.forEach(function (b) { b.hidden = !on; });
      }
      function buttons() {
        var s = st.status, f = fromCode();
        var viaAi = !!s && !s.legs && TR.ai.on();
        go.textContent = st.busy ? t("stop") : viaAi ? t("goAi") : (s && !s.ok && s.legs ? t("getGo", { mb: s.mb }) : t("go"));
        go.disabled = !st.busy && (!text.trim() || (!!s && !s.legs && !(viaAi && st.ai)));
        if (st.busy) return;
        var msg = from === "auto" && text.trim() ? t("detected", { lang: nm(f) }) + " " : "";
        if (!text.trim()) msg = t("empty");
        else if (viaAi) msg += st.ai ? t("viaAi", { name: st.ai.name }) : t("viaAiNone");
        else if (s && !s.legs) msg += t("nopair");
        else if (s && !s.ok) msg += t("need", { a: nm(f), b: nm(to), mb: s.mb });
        if (segs) msg = t("segs", { n: segs.length }) + ". " + msg;
        info.textContent = msg;
        info.className = "otp-info";
      }
      function refresh() {
        st.res = null;
        showDone(false);
        TR.status(fromCode(), to).then(function (s) {
          st.status = s;
          buttons();
          if (!s.legs && TR.ai.on() && !st.ai) TR.ai.ready().then(function (a) { st.ai = a; buttons(); }, function () {});
        }, function () { st.status = null; buttons(); });
      }
      function note(k, v, bad) {
        info.textContent = t(k, v);
        info.className = "otp-info" + (bad ? " err" : "");
      }
      function run() {
        if (st.busy) { st.stop = true; return; }
        var f = fromCode();
        if (!text.trim()) return;
        if (!TR.supported() && !(st.status && !st.status.legs)) { note("err.unsupported", null, true); return; }
        if (f === to) {
          st.res = segs ? { text: text, segments: segs.slice() } : { text: text };
          out.value = text;
          showDone(true);
          note("same", { lang: nm(to) });
          return;
        }
        st.busy = true; st.stop = false;
        buttons();
        var cancelled = function () { return st.stop; };
        TR.status(f, to).then(function (s) {
          if (!s.legs && !TR.ai.on()) { var e = new Error("pair"); e.code = "pair"; throw e; }
          if (s.ok || !s.legs) return null;
          note("downloading", { p: 0 });
          return TR.install(f, to, {
            cancelled: cancelled,
            progress: function (q) { note("downloading", { p: Math.round(q * 100) }); }
          });
        }).then(function () {
          note("working", { p: 0 });
          if (segs) {
            // each line of a segment on its own (a two-line subtitle
            // stays two lines), joined back in the same order
            var flat = [], cnt = [];
            segs.forEach(function (sg) { var ls = sg.split("\n"); cnt.push(ls.length); flat.push.apply(flat, ls); });
            return TR.translateMany(flat, {
              from: f, to: to, cancelled: cancelled,
              progress: function (d, n) { note("working", { p: Math.round(n ? d / n * 100 : 100) }); }
            }).then(function (r) {
              var list = [], k = 0;
              cnt.forEach(function (c) { list.push(r.slice(k, k + c).map(function (x) { return x.text; }).join("\n")); k += c; });
              return { text: list.join("\n"), segments: list, engine: r.length ? r[0].engine : "bergamot", via: r.length ? r[0].via : "" };
            });
          }
          return TR.translate(text, {
            from: f, to: to, cancelled: cancelled,
            progress: function (q) { note("working", { p: Math.round(q * 100) }); }
          });
        }).then(function (r) {
          st.busy = false;
          if (st.stop) { buttons(); return; }
          st.res = r;
          out.value = r.text;
          TR.status(f, to).then(function (s2) { st.status = s2; if (!st.busy) go.textContent = buttonsLabel(s2); }, function () {});
          buttons();
          showDone(true);
          if (r.engine === "ai") note("doneAi", { name: r.via || "AI", a: nm(f), b: nm(to) });
          else note("done", { a: nm(f), b: nm(to) });
        }, function (e) {
          st.busy = false;
          buttons();
          var c = e && e.code && STR.en["err." + e.code] ? e.code : "engine";
          note("err." + c, null, c !== "cancelled");
          TR.status(fromCode(), to).then(function (s) { st.status = s; if (!st.busy) go.textContent = buttonsLabel(s); }, function () {});
        });
      }
      function buttonsLabel(s) {
        var viaAi = !!s && !s.legs && TR.ai.on();
        return viaAi ? t("goAi") : (s && !s.ok && s.legs ? t("getGo", { mb: s.mb }) : t("go"));
      }
      refresh();
      setTimeout(function () { try { go.focus(); } catch (e) {} }, 0);
    }
    return dlg;
  }

  root.OrosTranslatePanel = { open: open, v: 1, STR: STR };
})(typeof window !== "undefined" ? window : this);
