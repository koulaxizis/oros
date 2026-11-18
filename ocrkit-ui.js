// ============================================================
// orOS Core — ocrkit-ui.js: the Text mode over a picture (LIVE-TEXT)
// ------------------------------------------------------------
// Loaded by ocrkit.js (OrosOcr.open) on the first press of a Text
// button, with ocrkit-ui.css. Exposes window.OrosOcrUI.open(o, K):
//   o.el       the <img> or <canvas> on screen, or
//   o.canvas   a picture to show in a stage of its own (full window,
//              the app's keys held back while it is open; Photo Lab)
//   o.source   what is read (default o.el / o.canvas): <img>, <canvas>, Blob
//   o.region   { x, y, w, h } fractions of the picture that o.source
//              shows (Capture's crop); the marks go inside it
//   o.key      a name for the picture: what was found is kept for
//              this page's session, so pressing Text again is instant
//   o.title    the item's name for Send to…
//   o.onClose  called once when the mode ends (any way)
//   K          window.OrosOcr (pure helpers + read / allowed / allow)
//   → controller { close(), words(), text() }
// What it does: asks once per device for the engine download (shared
// with Documents), reads the picture with a progress line and Stop,
// then marks the words found over the picture. Drag from word to
// word (or a box over the text) selects, a tap selects a line and a
// second tap its paragraph; Copy, Copy all, Text (the whole text in
// an editable panel) and Send to… (the shell's orosSend). Esc closes
// the panel, then the mode. Ctrl+A / Ctrl+C work on the words.
// Every string goes in with textContent; nothing found is ever HTML.
// ============================================================
// i18n-inline-ok: the strings of the Text mode in EN/EL/DE are data
(function (win) {
  "use strict";
  if (win.OrosOcrUI && win.OrosOcrUI.VERSION) return;
  var doc = win.document;
  var VERSION = "1.0.0";

  var STR = {
    en: {
      label: "Text in the picture", ask: "To read text, orOS downloads its text recognition engine once (Tesseract, about 7 MB, Greek and English) from its own site. After that it works offline, and nothing leaves this device.",
      askOk: "Download and read", cancel: "Cancel", reading: "Reading text… {p}%", start: "Reading text…", stop: "Stop",
      none: "No text found in this picture.", offline: "The text recognition engine could not be downloaded. Connect to the internet once and try again.",
      fail: "The text could not be read.", again: "Try again", close: "Close", hint: "Drag over the text to select it",
      sel1: "1 word selected", seln: "{n} words selected", copy: "Copy", copyAll: "Copy all", text: "Text", send: "Send to…",
      copied: "Copied", copyFail: "This browser could not copy. Select the text in the Text panel instead.",
      panel: "All text found (you can correct it before copying)", panelCopy: "Copy this text"
    },
    el: {
      label: "Κείμενο στην εικόνα", ask: "Για να διαβάσει κείμενο, το orOS κατεβάζει μία φορά τη μηχανή αναγνώρισης κειμένου (Tesseract, περίπου 7 MB, ελληνικά και αγγλικά) από τη δική του σελίδα. Μετά δουλεύει χωρίς σύνδεση και τίποτα δεν φεύγει από αυτή τη συσκευή.",
      askOk: "Λήψη και ανάγνωση", cancel: "Ακύρωση", reading: "Ανάγνωση κειμένου… {p}%", start: "Ανάγνωση κειμένου…", stop: "Διακοπή",
      none: "Δεν βρέθηκε κείμενο σε αυτή την εικόνα.", offline: "Η μηχανή αναγνώρισης κειμένου δεν κατέβηκε. Συνδέσου μία φορά στο διαδίκτυο και δοκίμασε ξανά.",
      fail: "Το κείμενο δεν διαβάστηκε.", again: "Ξανά", close: "Κλείσιμο", hint: "Σύρε πάνω στο κείμενο για να το επιλέξεις",
      sel1: "Επιλέχθηκε 1 λέξη", seln: "Επιλέχθηκαν {n} λέξεις", copy: "Αντιγραφή", copyAll: "Αντιγραφή όλων", text: "Κείμενο", send: "Αποστολή σε…",
      copied: "Αντιγράφηκε", copyFail: "Αυτός ο browser δεν αντέγραψε. Επίλεξε το κείμενο στο πλαίσιο Κείμενο.",
      panel: "Όλο το κείμενο που βρέθηκε (μπορείς να το διορθώσεις πριν το αντιγράψεις)", panelCopy: "Αντιγραφή αυτού του κειμένου"
    },
    de: {
      label: "Text im Bild", ask: "Um Text zu lesen, lädt orOS einmal seine Texterkennung (Tesseract, etwa 7 MB, Griechisch und Englisch) von der eigenen Seite. Danach funktioniert sie offline, und nichts verlässt dieses Gerät.",
      askOk: "Laden und lesen", cancel: "Abbrechen", reading: "Text wird gelesen… {p} %", start: "Text wird gelesen…", stop: "Stopp",
      none: "In diesem Bild wurde kein Text gefunden.", offline: "Die Texterkennung konnte nicht geladen werden. Verbinde dich einmal mit dem Internet und versuche es erneut.",
      fail: "Der Text konnte nicht gelesen werden.", again: "Erneut", close: "Schließen", hint: "Zum Auswählen über den Text ziehen",
      sel1: "1 Wort ausgewählt", seln: "{n} Wörter ausgewählt", copy: "Kopieren", copyAll: "Alles kopieren", text: "Text", send: "Senden an…",
      copied: "Kopiert", copyFail: "Dieser Browser konnte nicht kopieren. Wähle den Text stattdessen im Textfeld aus.",
      panel: "Der ganze gefundene Text (du kannst ihn vor dem Kopieren korrigieren)", panelCopy: "Diesen Text kopieren"
    }
  };
  function lang() {
    var c = "";
    try { if (win.orosI18n && win.orosI18n.lang) c = win.orosI18n.lang(); } catch (e) {}
    if (!c) try { if (win.parent !== win && typeof win.parent.orosLang === "string") c = win.parent.orosLang; } catch (e) {}
    if (!c) c = (doc.documentElement.getAttribute("lang") || "en").slice(0, 2);
    return STR[c] ? c : "en";
  }
  function T(k, v) {
    var s = STR[lang()][k] || STR.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(cls, text, fn) {
    var b = el("button", "ocx-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  function sendApi() {
    try { var p = win.parent; return p && p !== win && p.orosSend && typeof p.orosSend.open === "function" ? p.orosSend : null; }
    catch (e) { return null; }
  }
  function copyText(s) {
    if (win.navigator.clipboard && typeof win.navigator.clipboard.writeText === "function") {
      return win.navigator.clipboard.writeText(s).catch(function () { return legacyCopy(s); });
    }
    return legacyCopy(s);
  }
  function legacyCopy(s) {
    return new Promise(function (res, rej) {
      var ta = el("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) {}
      ta.remove();
      ok ? res() : rej(new Error("copy"));
    });
  }

  var found = {};            // o.key → { words, text } for this page's session
  var active = null;         // the one open controller

  function open(o, K) {
    if (active) active.close();
    var img = o.el, stage = null;
    if (!img && o.canvas) {
      stage = el("div", "ocx-stage");
      stage.setAttribute("role", "dialog");
      stage.setAttribute("aria-modal", "true");
      stage.setAttribute("aria-label", T("label"));
      var frame = el("div", "ocx-sframe");
      img = o.canvas;
      img.classList.add("ocx-simg");
      frame.appendChild(img);
      stage.appendChild(frame);
      ["pointerdown", "pointermove", "pointerup", "click", "dblclick", "wheel", "contextmenu"].forEach(function (ev) {
        stage.addEventListener(ev, function (e) { e.stopPropagation(); });
      });
      stage.tabIndex = -1;
      doc.body.appendChild(stage);
      try { stage.focus({ preventScroll: true }); } catch (e) {}
      if (!o.source) o.source = img;
    }
    if (!img || !img.parentNode) return null;
    var host = img.parentNode;
    var hostMarked = false;
    if (win.getComputedStyle(host).position === "static") { host.classList.add("ocx-host"); hostMarked = true; }

    var words = [], sel = [], job = null, closed = false, flashT = 0;
    var layer = el("div", "ocx-layer");
    layer.setAttribute("aria-hidden", "true");
    var box = el("div", "ocx-box");
    var band = el("div", "ocx-band");
    band.hidden = true;
    box.appendChild(band);
    layer.appendChild(box);
    host.appendChild(layer);

    var bar = el("div", "ocx-bar");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", T("label"));
    var status = el("div", "ocx-status");
    status.setAttribute("aria-live", "polite");
    var acts = el("div", "ocx-acts");
    bar.appendChild(status);
    bar.appendChild(acts);
    var panel = el("div", "ocx-panel");
    panel.hidden = true;
    var plab = el("label", "ocx-plab", T("panel"));
    var area = el("textarea", "ocx-area");
    area.id = "ocx-area-" + Date.now();
    plab.htmlFor = area.id;
    area.spellcheck = false;
    var pacts = el("div", "ocx-pacts");
    pacts.appendChild(btn("primary", T("panelCopy"), function () { doCopy(panelText()); }));
    panel.appendChild(plab);
    panel.appendChild(area);
    panel.appendChild(pacts);
    var dock = el("div", "ocx-dock");
    dock.appendChild(panel);
    dock.appendChild(bar);
    ["pointerdown", "pointerup", "click", "dblclick", "wheel", "touchstart"].forEach(function (ev) {
      dock.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    doc.body.appendChild(dock);

    // ---------- where the picture is drawn ----------
    function natural() {
      return [img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0];
    }
    function place() {
      if (closed) return;
      var W = img.offsetWidth, H = img.offsetHeight, n = natural();
      layer.style.left = img.offsetLeft + "px";
      layer.style.top = img.offsetTop + "px";
      layer.style.width = W + "px";
      layer.style.height = H + "px";
      layer.style.transform = img.style.transform || "";
      if (!n[0] || !n[1] || !W || !H) return;
      // object-fit: contain (Files, Photos) draws the picture centred in the box
      var fitMode = win.getComputedStyle(img).objectFit, s = 1, dw = W, dh = H;
      if (fitMode === "contain" || fitMode === "scale-down") {
        s = Math.min(W / n[0], H / n[1]);
        if (fitMode === "scale-down") s = Math.min(1, s);
        dw = n[0] * s; dh = n[1] * s;
      }
      var bx = (W - dw) / 2, by = (H - dh) / 2, R = o.region;
      if (R && R.w > 0 && R.h > 0) { bx += R.x * dw; by += R.y * dh; dw *= R.w; dh *= R.h; }
      box.style.left = bx + "px";
      box.style.top = by + "px";
      box.style.width = dw + "px";
      box.style.height = dh + "px";
    }
    var ro = null, mo = null;
    try { ro = new win.ResizeObserver(place); ro.observe(img); ro.observe(host); } catch (e) {}
    try { mo = new win.MutationObserver(place); mo.observe(img, { attributes: true, attributeFilter: ["style", "src", "class"] }); } catch (e) {}
    win.addEventListener("resize", place);
    if (img.tagName === "IMG" && !img.complete) img.addEventListener("load", place, { once: true });
    place();

    // ---------- the words ----------
    function paintWords() {
      [].slice.call(box.querySelectorAll(".ocx-w")).forEach(function (n) { n.remove(); });
      words.forEach(function (w, i) {
        var d = el("div", "ocx-w");
        d.style.left = w.x * 100 + "%";
        d.style.top = w.y * 100 + "%";
        d.style.width = w.w * 100 + "%";
        d.style.height = w.h * 100 + "%";
        d.dataset.i = i;
        box.appendChild(d);
      });
      paintSel();
    }
    function paintSel() {
      var on = {};
      sel.forEach(function (i) { on[i] = true; });
      [].slice.call(box.querySelectorAll(".ocx-w")).forEach(function (n) { n.classList.toggle("on", !!on[n.dataset.i]); });
      if (stateNow === "done") updDone();
    }
    function setSel(list) { sel = list || []; paintSel(); }

    // ---------- choosing words with the pointer ----------
    var drag = null;
    function pt(e) {
      var r = box.getBoundingClientRect();
      return { x: r.width ? (e.clientX - r.left) / r.width : 0, y: r.height ? (e.clientY - r.top) / r.height : 0, cx: e.clientX, cy: e.clientY };
    }
    function hit(p) {
      var m = 0.006;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (p.x >= w.x - m && p.x <= w.x + w.w + m && p.y >= w.y - m && p.y <= w.y + w.h + m) return i;
      }
      return -1;
    }
    layer.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      if (!words.length || e.button > 0) return;
      e.preventDefault();
      var p = pt(e);
      drag = { p: p, i: hit(p), moved: false, id: e.pointerId };
      try { layer.setPointerCapture(e.pointerId); } catch (x) {}
    });
    layer.addEventListener("pointermove", function (e) {
      e.stopPropagation();
      if (!drag || e.pointerId !== drag.id) return;
      var p = pt(e);
      if (!drag.moved && Math.abs(p.cx - drag.p.cx) + Math.abs(p.cy - drag.p.cy) < 6) return;
      drag.moved = true;
      if (drag.i >= 0) {
        setSel(K.between(words, drag.i, K.nearest(words, p.x, p.y)));
      } else {
        var r = { x: drag.p.x, y: drag.p.y, w: p.x - drag.p.x, h: p.y - drag.p.y };
        band.hidden = false;
        band.style.left = Math.min(r.x, r.x + r.w) * 100 + "%";
        band.style.top = Math.min(r.y, r.y + r.h) * 100 + "%";
        band.style.width = Math.abs(r.w) * 100 + "%";
        band.style.height = Math.abs(r.h) * 100 + "%";
        setSel(K.inRect(words, r));
      }
    });
    function endDrag(e) {
      e.stopPropagation();
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      band.hidden = true;
      if (d.moved) return;
      if (d.i < 0) { setSel([]); return; }
      var line = K.lineOf(words, d.i);
      var same = sel.length === line.length && line.every(function (v, k) { return sel[k] === v; });
      setSel(same ? K.paraOf(words, d.i) : line);
    }
    layer.addEventListener("pointerup", endDrag);
    layer.addEventListener("pointercancel", function (e) { drag = null; band.hidden = true; e.stopPropagation(); });
    ["click", "dblclick", "touchstart", "wheel"].forEach(function (ev) {
      layer.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: ev === "touchstart" || ev === "wheel" });
    });

    // ---------- the bar ----------
    var stateNow = "";
    function setStatus(s) { status.textContent = s; }
    function setActs(list) {
      acts.innerHTML = "";
      list.forEach(function (b) { if (b) acts.appendChild(b); });
    }
    function closeBtn() {
      var b = btn("ocx-x", "×", close);
      b.title = T("close");
      b.setAttribute("aria-label", T("close"));
      return b;
    }
    function flash(s) {
      clearTimeout(flashT);
      setStatus(s);
      flashT = setTimeout(function () { if (stateNow === "done") updDone(); }, 1800);
    }
    function doCopy(s) {
      if (!s) return;
      copyText(s).then(function () { flash(T("copied")); }, function () { flash(T("copyFail")); });
    }
    function selText() { return K.textOf(words, sel); }
    function panelText() {
      var a = area.selectionStart, b = area.selectionEnd;
      return a !== b ? area.value.slice(Math.min(a, b), Math.max(a, b)) : area.value;
    }
    function bestText() {
      if (!panel.hidden) return panelText();
      return sel.length ? selText() : K.textOf(words);
    }
    var bCopy = null;
    function updDone() {
      clearTimeout(flashT);
      setStatus(sel.length ? (sel.length === 1 ? T("sel1") : T("seln", { n: sel.length })) : T("hint"));
      if (bCopy) bCopy.disabled = !sel.length;
    }
    function paintDone() {
      stateNow = "done";
      bCopy = btn("primary", T("copy"), function () { doCopy(selText()); });
      updDone();
      var bText = btn(panel.hidden ? "" : "on", T("text"), togglePanel);
      bText.setAttribute("aria-pressed", panel.hidden ? "false" : "true");
      var S = sendApi();
      setActs([bCopy, btn("", T("copyAll"), function () { doCopy(K.textOf(words)); }), bText,
        S ? btn("", T("send"), function () {
          var s = bestText();
          if (s) S.open({ kind: "text", data: { title: String(o.title || "").slice(0, 200), text: s } });
        }) : null,
        closeBtn()]);
    }
    function togglePanel() {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { if (!area.value) area.value = K.textOf(words); area.focus(); }
      paintDone();
    }
    function show(state) {
      stateNow = state;
      dock.classList.toggle("busy", state === "reading");
      layer.classList.toggle("scan", state === "reading");
      if (state === "ask") {
        setStatus(T("ask"));
        setActs([btn("primary", T("askOk"), function () { K.allow(); run(); }), btn("", T("cancel"), close)]);
      } else if (state === "reading") {
        setStatus(T("start"));
        setActs([btn("", T("stop"), function () { if (job) job.stop = true; close(); })]);
      } else if (state === "none") {
        setStatus(T("none"));
        setActs([btn("", T("close"), close)]);
      } else if (state === "offline" || state === "fail") {
        setStatus(T(state));
        setActs([btn("primary", T("again"), run), btn("", T("close"), close)]);
      } else if (state === "done") {
        paintDone();
      }
    }
    function got(res) {
      words = res.words || [];
      if (o.key) found[o.key] = { words: words };
      area.value = K.textOf(words);
      paintWords();
      show(words.length ? "done" : "none");
      layer.classList.toggle("lit", words.length > 0);
    }
    function run() {
      if (closed) return;
      if (o.key && found[o.key]) { got(found[o.key]); return; }
      job = { stop: false };
      var my = job;
      show("reading");
      K.read(o.source || img, {
        job: my,
        onStep: function (p) { if (!closed && my === job) setStatus(T("reading", { p: p })); }
      }).then(function (res) {
        if (closed || my !== job) return;
        got(res);
      }, function (e) {
        if (closed || my !== job) return;
        show(e && e.code === "offline" ? "offline" : e && e.code === "stop" ? "none" : "fail");
      });
    }

    // ---------- keys ----------
    function onKey(e) {
      if (closed) return;
      var inArea = e.target === area;
      // the stage covers the app: none of its shortcuts act behind it
      if (stage && e.key !== "Escape") e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        if (!panel.hidden) { panel.hidden = true; if (stateNow === "done") paintDone(); }
        else close();
        return;
      }
      if (inArea || !words.length || !(e.ctrlKey || e.metaKey)) return;
      var tg = e.target && e.target.tagName;
      if (tg === "INPUT" || tg === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      if (e.key === "a" || e.key === "A") { e.preventDefault(); e.stopPropagation(); setSel(K.between(words, 0, words.length - 1)); }
      else if ((e.key === "c" || e.key === "C") && sel.length) { e.preventDefault(); e.stopPropagation(); doCopy(selText()); }
    }
    win.addEventListener("keydown", onKey, true);

    function close() {
      if (closed) return;
      closed = true;
      if (job) job.stop = true;
      clearTimeout(flashT);
      win.removeEventListener("keydown", onKey, true);
      win.removeEventListener("resize", place);
      try { if (ro) ro.disconnect(); if (mo) mo.disconnect(); } catch (e) {}
      layer.remove();
      dock.remove();
      if (stage) stage.remove();
      if (hostMarked) host.classList.remove("ocx-host");
      if (active === ctl) active = null;
      if (typeof o.onClose === "function") try { o.onClose(); } catch (e) {}
    }
    var ctl = { close: close, words: function () { return words.slice(); }, text: function () { return K.textOf(words); },
                isOpen: function () { return !closed; } };
    active = ctl;
    if (o.key && found[o.key]) got(found[o.key]);
    else if (K.allowed()) run();
    else show("ask");
    return ctl;
  }

  win.OrosOcrUI = { VERSION: VERSION, open: open, STR: STR };
})(window);
