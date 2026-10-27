// ============================================================
// orOS — osk.js (on-screen keyboard, v1.0.0)
// ------------------------------------------------------------
// A shell component, like seasonal.js and quickmenu.js: it runs IN
// the shell document and keeps its own device-local storage. shell.js
// calls attach() once at boot and refresh() when the language
// changes. A bundle without this file draws exactly what it drew
// before.
//
//   • A keyboard at the bottom of the screen for touch screens that
//     have no keyboard of their own: orOS USB on a touch laptop or a
//     tablet PC (the kiosk has no system keyboard), touch PCs, kiosks.
//     Layouts: English (QWERTY), Greek (with the accent ΄ and the
//     diaeresis ¨ as dead keys), German (QWERTZ, ü ö ä ß). Shift (tap
//     twice for Caps Lock), two pages of numbers and symbols,
//     Backspace (repeats while held), Enter, Space, ← →, a key that
//     goes to the next layout and one that hides the keyboard.
//   • When it opens (Settings › Language & search › On-screen
//     keyboard, device-local):
//       "auto"   a tap with a finger or a pen in a text field, as long
//                as no real key was pressed in the last 30 minutes
//                (a keyboard is there); a mouse click or an app's own
//                focus never opens it; a real key press closes it;
//       "button" only from its button in the top bar;
//       "off"    never, and no button.
//     Default: "auto" on orOS USB (<html data-oros-kiosk="usb">, set
//     by its system extension) and on Linux with a touch screen;
//     "button" on other touch screens (Windows, ChromeOS and tablets
//     have a keyboard of their own); "off" without a touch screen.
//     NEVER on phones: no keyboard, no button, no Settings card.
//   • Typing goes to the focused text field of the shell or of any
//     same-origin app frame (input, textarea, contentEditable), at
//     the caret, through the browser's own editing (execCommand
//     insertText / delete, so undo and the app's input events work),
//     with a fallback through setRangeText. Each key first goes to
//     the field as a keydown; an app that takes it (preventDefault)
//     keeps it, so games and the apps' own Enter handling see keys.
//     Opened from the button with no text field, the keys go to the
//     app in front as key events only (games).
//   • It never covers the field: the app area ends above the keyboard
//     (body.osk-open, --osk-h), the field is scrolled into view, and a
//     fixed panel (a dialog) that would still be covered is lifted.
//     While it shows, the field gets inputmode="none" so a system
//     keyboard does not open as well; the old value comes back after.
//
// Device-local (oros-osk, never synced; written on a change in
// Settings or a tap on the layout key only):
//   { v:1, mode?: "auto"|"button"|"off", layouts?: ["en","el","de"],
//     last?: "en"|"el"|"de" }
//   An absent field means the default above.
//
// Pure logic (layouts, keys, accents, defaults, prefs) is unit-tested
// in node (tests/osk.test.js); the typing in a browser by
// .github/qa/osk.js.
// ============================================================
// i18n-inline-ok: the Greek letters below are keyboard layout data (keys and accents), no UI text
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEY = "oros-osk";
  var MODES = ["auto", "button", "off"];
  var HW_QUIET = 30 * 60 * 1000;     // a real key this recently: a keyboard is there
  var TOUCH_WINDOW = 900;            // ms from a finger's tap to the focus it gave

  // ---------- 1. Layouts ----------
  // Rows of letters; "΄" is the Greek dead key (shift: "¨").
  var LAYOUTS = {
    en: { name: "English", short: "EN", rows: ["qwertyuiop", "asdfghjkl", "zxcvbnm"] },
    el: { name: "Ελληνικά", short: "ΕΛ", rows: [";ςερτυθιοπ", "ασδφγηξκλ΄", "ζχψωβνμ"] },
    de: { name: "Deutsch", short: "DE", rows: ["qwertzuiopü", "asdfghjklöä", "yxcvbnmß"] }
  };
  var LAYOUT_IDS = ["en", "el", "de"];
  var SYMBOLS = {
    sym:  ["1234567890", "@#€%&-+()/", "*\"':;!?"],
    more: ["[]{}^=_\\|~", "<>$£¥•°§`", ".,…¿¡«»"]
  };
  // Shift on a character that is not a letter.
  var SHIFTED = { ";": ":", "ß": "ß", "΄": "¨" };
  var DEAD = { "΄": "tonos", "¨": "dia" };
  var DEAD_CHAR = { tonos: "΄", dia: "¨" };
  var COMBINE = {
    tonos: { "α": "ά", "ε": "έ", "η": "ή", "ι": "ί", "ο": "ό", "υ": "ύ", "ω": "ώ",
             "Α": "Ά", "Ε": "Έ", "Η": "Ή", "Ι": "Ί", "Ο": "Ό", "Υ": "Ύ", "Ω": "Ώ",
             "ϊ": "ΐ", "ϋ": "ΰ" },
    dia:   { "ι": "ϊ", "υ": "ϋ", "Ι": "Ϊ", "Υ": "Ϋ", "ί": "ΐ", "ύ": "ΰ" }
  };

  function shiftChar(c) {
    if (Object.prototype.hasOwnProperty.call(SHIFTED, c)) return SHIFTED[c];
    var u = c.toUpperCase();
    return u.length === 1 ? u : c;
  }
  // A dead key followed by ch: the accented letter, else both as they are.
  function combine(dead, ch) {
    var t = COMBINE[dead];
    if (t && Object.prototype.hasOwnProperty.call(t, ch)) return t[ch];
    if (ch === " ") return DEAD_CHAR[dead] || "";
    return (DEAD_CHAR[dead] || "") + ch;
  }

  // The keys of one page. layer: "abc" | "sym" | "more"; shift: 0 off,
  // 1 once, 2 Caps Lock. A key: { k, v?, w? } with k "ch" (v = the
  // character it types), "dead" (v = "tonos" | "dia"), "shift", "back",
  // "enter", "space", "sym", "abc", "more", "lang", "left", "right",
  // "hide". w = width in key units (default 1).
  function keyRows(layout, layer, shift) {
    var L = LAYOUTS[layout] || LAYOUTS.en;
    var src = layer === "sym" || layer === "more" ? SYMBOLS[layer] : L.rows;
    var up = layer === "abc" && shift > 0;
    var rows = src.map(function (s) {
      return s.split("").map(function (c) {
        var v = up ? shiftChar(c) : c;
        if (layer === "abc" && DEAD[v]) return { k: "dead", v: DEAD[v] };
        return { k: "ch", v: v };
      });
    });
    var r3 = rows[2];
    r3.unshift(layer === "abc" ? { k: "shift", w: 1.4 } : { k: layer === "sym" ? "more" : "sym", w: 1.4 });
    r3.push({ k: "back", w: 1.4 });
    rows.push([
      { k: layer === "abc" ? "sym" : "abc", w: 1.4 },
      { k: "lang" },
      { k: "ch", v: "," },
      { k: "space", w: 3.6 },
      { k: "ch", v: "." },
      { k: "left" },
      { k: "right" },
      { k: "enter", w: 1.6 },
      { k: "hide" }
    ]);
    return rows;
  }

  // ---------- 2. Device, defaults, prefs ----------
  // env: { ua, mobile (userAgentData.mobile), coarse (pointer: coarse),
  //        anyCoarse, touchPoints, screenMin, kiosk }
  function isPhone(env) {
    if (!env) return false;
    if (env.mobile === true) return true;
    var ua = String(env.ua || "");
    if (/iPhone|iPod|Windows Phone/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
    return !!(env.coarse && env.screenMin > 0 && env.screenMin < 600);
  }
  function hasTouch(env) {
    return !!(env && (env.kiosk || env.anyCoarse || env.touchPoints > 0));
  }
  // Linux desktops (and the orOS USB kiosk) have no system keyboard
  // of their own; Windows, ChromeOS, Android and iPadOS do.
  function ownKeyboard(env) {
    var ua = String((env && env.ua) || "");
    return /Windows|Android|CrOS|iPad|Macintosh/i.test(ua) || !/Linux|X11/i.test(ua);
  }
  function defaultMode(env) {
    if (isPhone(env)) return "off";
    if (env && env.kiosk) return "auto";
    if (!hasTouch(env)) return "off";
    return ownKeyboard(env) ? "button" : "auto";
  }
  function defaultLayouts(lang) {
    return lang === "de" ? ["en", "de"] : ["en", "el"];
  }
  // Stored prefs, cleaned: only known values survive.
  function normPrefs(p) {
    var out = { v: 1 };
    if (!p || typeof p !== "object") return out;
    if (MODES.indexOf(p.mode) !== -1) out.mode = p.mode;
    if (Array.isArray(p.layouts)) {
      var ls = LAYOUT_IDS.filter(function (id) { return p.layouts.indexOf(id) !== -1; });
      if (ls.length) out.layouts = ls;
    }
    if (LAYOUT_IDS.indexOf(p.last) !== -1) out.last = p.last;
    return out;
  }
  function modeOf(prefs, env) {
    if (isPhone(env)) return "off";
    return (prefs && MODES.indexOf(prefs.mode) !== -1) ? prefs.mode : defaultMode(env);
  }
  function layoutsOf(prefs, lang) {
    return (prefs && prefs.layouts && prefs.layouts.length) ? prefs.layouts.slice() : defaultLayouts(lang);
  }
  // Which layout shows: the last one picked, else the orOS language,
  // else the first one on.
  function startLayout(prefs, lang) {
    var ls = layoutsOf(prefs, lang);
    if (prefs && prefs.last && ls.indexOf(prefs.last) !== -1) return prefs.last;
    if (ls.indexOf(lang) !== -1) return lang;
    return ls[0];
  }
  function nextLayout(ls, cur) {
    var i = ls.indexOf(cur);
    return ls[(i + 1) % ls.length] || ls[0];
  }
  // Prefs after turning one layout on or off. The last one stays on.
  function withLayout(prefs, lang, id, on) {
    var p = normPrefs(prefs), ls = layoutsOf(p, lang);
    if (LAYOUT_IDS.indexOf(id) === -1) return p;
    if (on && ls.indexOf(id) === -1) ls.push(id);
    if (!on) ls = ls.filter(function (x) { return x !== id; });
    if (!ls.length) return p;
    p.layouts = LAYOUT_IDS.filter(function (x) { return ls.indexOf(x) !== -1; });
    if (p.last && p.layouts.indexOf(p.last) === -1) delete p.last;
    return p;
  }

  var TEXT_TYPES = /^(text|search|url|email|tel|password|number)?$/i;
  // Can this element take typed text? (Duck-typed, for node too.)
  function editable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    var tag = String(el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") return TEXT_TYPES.test(String((el.getAttribute && el.getAttribute("type")) || ""));
    return !!el.isContentEditable;
  }

  var model = {
    VER: VER, KEY: KEY, MODES: MODES, LAYOUTS: LAYOUTS, LAYOUT_IDS: LAYOUT_IDS, SYMBOLS: SYMBOLS,
    shiftChar: shiftChar, combine: combine, keyRows: keyRows,
    isPhone: isPhone, hasTouch: hasTouch, defaultMode: defaultMode, defaultLayouts: defaultLayouts,
    normPrefs: normPrefs, modeOf: modeOf, layoutsOf: layoutsOf, startLayout: startLayout,
    nextLayout: nextLayout, withLayout: withLayout, editable: editable
  };
  if (typeof module === "object" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 3. Shell side ----------
  var doc = document;
  var host = null, env = null, prefs = { v: 1 };
  var box = null, btn = null;
  var st = { open: false, pinned: false, layer: "abc", shift: 0, dead: null, lay: "en", shiftAt: 0 };
  var target = null;                    // { w, el } the field the keys go to
  var hwAt = 0, touchAt = 0;            // last real key press / last finger tap
  var checkT = null, repeatT = null, repeatI = null, clickSkip = 0;
  var imEls = [];                       // [{ el, had, old }] inputmode we set
  var lifted = [];                      // [{ el, old }] panels we lifted
  var parked = null;                    // the modal dialog the keyboard sits in

  function tr(k, vars) {
    var f = root.t, v = typeof f === "function" ? f("osk." + k) : "";
    v = v && v !== "osk." + k ? v : k;
    if (vars) Object.keys(vars).forEach(function (n) { v = v.split("{" + n + "}").join(vars[n]); });
    return v;
  }
  function lang() { return (host && host.lang && host.lang()) || "en"; }
  function readPrefs() {
    try { return normPrefs(JSON.parse(root.localStorage.getItem(KEY) || "null")); } catch (e) { return { v: 1 }; }
  }
  function writePrefs() {
    try { root.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {
      if (host && host.toast) host.toast(tr("saveFail"));
    }
  }
  function mq(q) { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (e) { return false; } }
  function readEnv() {
    var nav = root.navigator || {}, sc = root.screen || {};
    return {
      ua: nav.userAgent || "",
      mobile: nav.userAgentData ? nav.userAgentData.mobile : undefined,
      coarse: mq("(pointer: coarse)"),
      anyCoarse: mq("(any-pointer: coarse)"),
      touchPoints: Number(nav.maxTouchPoints) || 0,
      screenMin: Math.min(Number(sc.width) || 0, Number(sc.height) || 0),
      kiosk: doc.documentElement.getAttribute("data-oros-kiosk") === "usb"
    };
  }
  function mode() { return modeOf(prefs, env); }

  // ---- Finding the field ----
  // Into open shadow roots too (the orOS USB System panel is one).
  function deep(a) {
    for (var i = 0; i < 4 && a && a.shadowRoot && a.shadowRoot.activeElement; i++) a = a.shadowRoot.activeElement;
    return a;
  }
  function focused() {
    var w = root, d = doc, a = deep(d.activeElement);
    for (var i = 0; i < 4 && a && a.tagName === "IFRAME"; i++) {
      try { w = a.contentWindow; d = w.document; a = deep(d.activeElement); } catch (e) { return null; }
    }
    return editable(a) ? { w: w, el: a } : null;
  }
  function parentOf(n) {
    if (n.parentElement) return n.parentElement;
    var r = n.getRootNode && n.getRootNode();
    return (r && r.host) || null;
  }
  function appWantsNone(el) {
    return el.getAttribute && el.getAttribute("inputmode") === "none" && !el.hasAttribute("data-osk-im");
  }
  function live(t) {
    try { return !!(t && t.el.isConnected && t.el.ownerDocument === t.w.document && editable(t.el)); } catch (e) { return false; }
  }
  // The field in use: the focused one, else the last one while its
  // frame still holds it (a tap on a key never moves the focus, but a
  // browser may still blur the frame).
  function curTarget() {
    var t = focused();
    if (t && appWantsNone(t.el) && !st.pinned) t = null;
    if (!t && live(target) && target.w.document.activeElement === target.el && target.w !== root) t = target;
    if (t && (!target || target.el !== t.el)) { restoreNative(); if (st.open) quietNative(t.el); }
    target = t;
    return t;
  }

  // ---- inputmode: no system keyboard on top of this one ----
  function quietNative(el) {
    var tag = el.tagName;
    if ((tag !== "INPUT" && tag !== "TEXTAREA") || el.hasAttribute("data-osk-im")) return;
    imEls.push({ el: el, had: el.hasAttribute("inputmode"), old: el.getAttribute("inputmode") });
    el.setAttribute("data-osk-im", "1");
    el.setAttribute("inputmode", "none");
  }
  function restoreNative() {
    imEls.forEach(function (x) {
      try {
        x.el.removeAttribute("data-osk-im");
        if (x.had) x.el.setAttribute("inputmode", x.old); else x.el.removeAttribute("inputmode");
      } catch (e) {}
    });
    imEls = [];
  }

  // ---- Wiring the shell and every same-origin frame ----
  function isTouch(e) { return e.pointerType === "touch" || e.pointerType === "pen"; }
  function inBox(e) {
    var n = e.target;
    return !!(box && n && n.nodeType === 1 && box.contains(n)) || !!(btn && n && btn.contains && btn.contains(n));
  }
  function onPtr(e) {
    if (inBox(e)) return;
    if (isTouch(e)) touchAt = Date.now();
    if (e.type === "pointerup") schedule(isTouch(e) ? 80 : 20);
  }
  function onKey(e) {
    if (!e.isTrusted) return;                   // our own key events
    if (/^(Shift|Control|Alt|Meta|AltGraph|CapsLock|Fn|Unidentified|Process)$/.test(e.key || "")) return;
    if ((e.key || "").length === 0) return;
    hwAt = Date.now();
    if (st.open && !st.pinned) hide();
  }
  function onFocusChange() { schedule(120); }
  // Per document: a frame's first about:blank and the app that replaces
  // it can share one window, never one document.
  function wire(d) {
    try {
      if (!d || d.__orosOsk) return;
      d.__orosOsk = 1;
      d.addEventListener("pointerdown", onPtr, true);
      d.addEventListener("pointerup", onPtr, true);
      d.addEventListener("keydown", onKey, true);
      d.addEventListener("focusin", onFocusChange, true);
      d.addEventListener("focusout", onFocusChange, true);
    } catch (e) { /* not same-origin */ }
  }
  function wireFrame(f) { try { wire(f.contentDocument); } catch (e) {} }
  // The shell is navigating frame f to an app (shell.js frameGo): wire
  // the new document as soon as it exists, long before its "load"
  // (fonts and pictures can hold that back past the first tap).
  function watch(f) {
    var old = null, n = 0;
    try { old = f.contentDocument; } catch (e) { return; }
    var iv = setInterval(function () {
      var d = null;
      try { d = f.contentDocument; } catch (e) { clearInterval(iv); return; }
      if (d && d !== old) {
        wire(d);
        if (d.URL !== "about:blank") { clearInterval(iv); return; }
      }
      if (++n > 250) clearInterval(iv);          // 20 s
    }, 80);
  }

  function hwRecent() { return hwAt && Date.now() - hwAt < HW_QUIET; }
  function schedule(ms) {
    clearTimeout(checkT);
    checkT = setTimeout(check, ms);
  }
  // After a tap or a focus change: follow the field, open or close. It
  // opens by itself only for a field focused right after a finger's or
  // a pen's tap (in the field, or on a button that focused it).
  function check() {
    checkT = null;
    var t = focused();
    if (t && appWantsNone(t.el) && !st.pinned) t = null;
    if (t) {
      curTarget();
      if (st.open) { place(); return; }
      if (touchAt && Date.now() - touchAt < TOUCH_WINDOW && mode() === "auto" && !hwRecent()) show(false);
      return;
    }
    if (st.open && !st.pinned) hide();
  }

  // ---- Typing ----
  function codeOf(key) {
    if (/^[a-z]$/i.test(key)) return "Key" + key.toUpperCase();
    if (/^[0-9]$/.test(key)) return "Digit" + key;
    if (key === " ") return "Space";
    if (/^(Backspace|Enter|ArrowLeft|ArrowRight)$/.test(key)) return key;
    return "";
  }
  // keydown (and keypress for a character or Enter) to node; false
  // when the app took it.
  function keyDown(w, node, key) {
    var KE = w.KeyboardEvent || root.KeyboardEvent;
    var o = { key: key, code: codeOf(key), bubbles: true, cancelable: true, composed: true };
    var go = node.dispatchEvent(new KE("keydown", o));
    if (go && (key.length === 1 || key === "Enter")) {
      try { go = node.dispatchEvent(new KE("keypress", o)); } catch (e) {}
    }
    return go;
  }
  function keyUp(w, node, key) {
    var KE = w.KeyboardEvent || root.KeyboardEvent;
    try { node.dispatchEvent(new KE("keyup", { key: key, code: codeOf(key), bubbles: true, cancelable: true, composed: true })); } catch (e) {}
  }
  function fireInput(t, type, data) {
    try {
      var IE = t.w.InputEvent || root.InputEvent;
      t.el.dispatchEvent(new IE("input", { bubbles: true, inputType: type, data: data }));
    } catch (e) {}
  }
  function refocus(t) {
    try { if (t.w.document.activeElement !== t.el) t.el.focus({ preventScroll: true }); } catch (e) {}
  }
  function exec(t, cmd, val) {
    try { return !!t.w.document.execCommand(cmd, false, val); } catch (e) { return false; }
  }
  function isField(el) { return el.tagName === "INPUT" || el.tagName === "TEXTAREA"; }
  function rangeSet(t, s, a, b) {
    var el = t.el;
    try { el.setRangeText(s, a, b, "end"); return true; } catch (e) {}
    if (s) { el.value = String(el.value || "") + s; return true; }
    return false;
  }
  function insertText(t, s) {
    if (exec(t, "insertText", s)) return;
    var el = t.el;
    if (isField(el)) {
      var a = el.selectionStart, b = el.selectionEnd;
      if (a == null) { a = b = String(el.value || "").length; }
      if (rangeSet(t, s, a, b)) fireInput(t, "insertText", s);
      return;
    }
    var sel = t.w.getSelection && t.w.getSelection();
    if (!sel || !sel.rangeCount) return;
    var r = sel.getRangeAt(0);
    r.deleteContents();
    var n = t.w.document.createTextNode(s);
    r.insertNode(n);
    r.setStartAfter(n);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    fireInput(t, "insertText", s);
  }
  function deleteBack(t) {
    if (exec(t, "delete")) return;
    var el = t.el;
    if (!isField(el)) return;
    var a = el.selectionStart, b = el.selectionEnd;
    if (a == null) { a = b = String(el.value || "").length; }
    if (a === b) {
      if (!a) return;
      var v = String(el.value || ""), c = v.charCodeAt(a - 1);
      a -= (c >= 0xdc00 && c <= 0xdfff && a > 1) ? 2 : 1;      // a whole emoji
    }
    if (rangeSet(t, "", a, b)) fireInput(t, "deleteContentBackward", null);
  }
  function enter(t) {
    var el = t.el;
    if (el.tagName === "TEXTAREA") { insertText(t, "\n"); return; }
    if (!isField(el)) { if (!exec(t, "insertParagraph")) insertText(t, "\n"); return; }
    var f = el.form;
    if (f && typeof f.requestSubmit === "function") { try { f.requestSubmit(); } catch (e) {} }
  }
  function move(t, dir) {
    var el = t.el;
    if (isField(el)) {
      try {
        var a = el.selectionStart, b = el.selectionEnd, n = String(el.value || "").length;
        if (a == null) return;
        var p = dir < 0 ? (a === b ? Math.max(0, a - 1) : a) : (a === b ? Math.min(n, b + 1) : b);
        el.setSelectionRange(p, p);
      } catch (e) {}
      return;
    }
    var sel = t.w.getSelection && t.w.getSelection();
    if (sel && sel.modify) sel.modify("move", dir < 0 ? "backward" : "forward", "character");
  }
  // The app in front, for keys with no text field (games).
  function frontWin() {
    var a = doc.activeElement, w = root;
    for (var i = 0; i < 4 && a && a.tagName === "IFRAME"; i++) {
      try { w = a.contentWindow; a = w.document.activeElement; } catch (e) { return root; }
    }
    if (w === root) {
      var run = doc.getElementById("oros-running"), f = doc.getElementById("app-frame");
      if (run && run.classList.contains("active") && f) {
        try { if (f.contentWindow && f.contentWindow.document) w = f.contentWindow; } catch (e) {}
      }
    }
    return w;
  }
  // One key: to the field, else to the app in front as events only.
  function send(key, act) {
    var t = curTarget();
    if (!t) {
      var w = frontWin(), node;
      try { node = w.document.activeElement || w.document.body; } catch (e) { return; }
      if (!node) return;
      keyDown(w, node, key);
      keyUp(w, node, key);
      return;
    }
    refocus(t);
    if (keyDown(t.w, t.el, key)) act(t);
    keyUp(t.w, t.el, key);
    if (st.open) place();
  }
  function typeChar(s) { send(s, function (t) { insertText(t, s); }); }

  // ---- Keys ----
  function press(key) {
    var now = Date.now();
    switch (key.k) {
      case "ch": {
        var s = key.v;
        if (st.dead) { s = combine(st.dead, s); st.dead = null; }
        typeChar(s);
        if (st.shift === 1) st.shift = 0;
        break;
      }
      case "dead":
        if (st.dead) { var d0 = DEAD_CHAR[st.dead]; st.dead = null; typeChar(d0); }
        else st.dead = key.v;
        if (st.shift === 1) st.shift = 0;
        break;
      case "shift":
        if (st.shift === 1 && now - st.shiftAt < 450) st.shift = 2;
        else st.shift = st.shift ? 0 : 1;
        st.shiftAt = now;
        break;
      case "back":
        if (st.dead) { st.dead = null; break; }
        send("Backspace", deleteBack);
        return;                          // no redraw while it repeats
      case "enter":
        if (st.dead) { var d1 = DEAD_CHAR[st.dead]; st.dead = null; typeChar(d1); }
        send("Enter", enter);
        break;
      case "space":
        if (st.dead) { var d2 = DEAD_CHAR[st.dead]; st.dead = null; typeChar(d2); }
        else typeChar(" ");
        break;
      case "left":  send("ArrowLeft", function (t) { move(t, -1); }); return;
      case "right": send("ArrowRight", function (t) { move(t, 1); }); return;
      case "sym": case "more": case "abc":
        st.layer = key.k; st.dead = null;
        break;
      case "lang": {
        var ls = layoutsOf(prefs, lang());
        st.lay = nextLayout(ls, st.lay);
        st.dead = null; st.layer = "abc";
        prefs.last = st.lay;
        writePrefs();
        break;
      }
      case "hide": hide(); return;
    }
    render();
  }

  // ---- Drawing ----
  var SVG = {
    shift: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 4 12h4v7h8v-7h4z"/></svg>',
    caps: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 4 12h4v5h8v-5h4z"/><path d="M8 20h8" fill="none"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="m12 9 5 6m0-6-5 6"/></svg>',
    enter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M19 5v7H6"/><path d="m10 8-4 4 4 4"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>',
    hide: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="11" rx="2"/><path d="M7 8h.01M11 8h.01M15 8h.01M8 12h8M9 18l3 3 3-3"/></svg>',
    kbd: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>'
  };
  function keyLabel(key) {
    switch (key.k) {
      case "ch": return { text: key.v };
      case "dead": return { text: DEAD_CHAR[key.v], aria: tr(key.v) };
      case "shift": return { svg: st.shift === 2 ? SVG.caps : SVG.shift, aria: tr(st.shift === 2 ? "caps" : "shift") };
      case "back": return { svg: SVG.back, aria: tr("back") };
      case "enter": return { svg: SVG.enter, aria: tr("enter") };
      case "space": return { text: LAYOUTS[st.lay].name, aria: tr("space") };
      case "sym": return { text: "?123", aria: tr("sym") };
      case "more": return { text: "=\\<", aria: tr("more") };
      case "abc": return { text: st.lay === "el" ? "αβγ" : "abc", aria: tr("abc") };
      case "lang": return { text: LAYOUTS[st.lay].short, aria: tr("lang", { name: LAYOUTS[nextLayout(layoutsOf(prefs, lang()), st.lay)].name }) };
      case "left": return { svg: SVG.left, aria: tr("left") };
      case "right": return { svg: SVG.right, aria: tr("right") };
      case "hide": return { svg: SVG.hide, aria: tr("hide") };
    }
    return { text: "" };
  }
  function stopRepeat() {
    clearTimeout(repeatT); clearInterval(repeatI);
    repeatT = repeatI = null;
  }
  function makeKey(key) {
    var b = doc.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.className = "osk-key osk-" + key.k;
    if (key.w) b.style.flexGrow = String(key.w);
    var lab = keyLabel(key);
    if (lab.svg) b.innerHTML = lab.svg;              // static icons only
    else b.textContent = lab.text;
    if (lab.aria) b.setAttribute("aria-label", lab.aria);
    if (key.k === "shift") b.setAttribute("aria-pressed", st.shift ? "true" : "false");
    if (key.k === "dead") b.setAttribute("aria-pressed", st.dead === key.v ? "true" : "false");
    b.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (e.button > 0) return;
      clickSkip = Date.now();
      b.classList.add("down");
      try { b.setPointerCapture(e.pointerId); } catch (e2) {}
      press(key);
      if (key.k === "back" || key.k === "left" || key.k === "right") {
        stopRepeat();
        repeatT = setTimeout(function () { repeatI = setInterval(function () { press(key); }, 70); }, 450);
      }
    });
    function up() { b.classList.remove("down"); stopRepeat(); }
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("lostpointercapture", up);
    // A click with no pointer before it (a screen reader, Enter on the key).
    b.addEventListener("click", function () { if (Date.now() - clickSkip > 700) press(key); });
    return b;
  }
  function build() {
    if (box) return;
    box = doc.createElement("div");
    box.id = "osk";
    box.setAttribute("role", "group");
    box.hidden = true;
    box.addEventListener("mousedown", function (e) { e.preventDefault(); });
    box.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    doc.body.appendChild(box);
  }
  function render() {
    if (!box) return;
    box.setAttribute("aria-label", tr("title"));
    box.setAttribute("lang", st.lay === "el" ? "el" : st.lay);
    box.className = (st.shift ? "is-shift" : "") + (st.dead ? " is-dead" : "");
    while (box.firstChild) box.removeChild(box.firstChild);
    keyRows(st.lay, st.layer, st.shift).forEach(function (row) {
      var r = doc.createElement("div");
      r.className = "osk-row";
      row.forEach(function (k) { r.appendChild(makeKey(k)); });
      box.appendChild(r);
    });
    paintBtn();
  }

  // ---- Not covering the field ----
  function rectTop(t) {
    var r = t.el.getBoundingClientRect(), y = 0, w = t.w;
    for (var i = 0; i < 4 && w !== root; i++) {
      var fe = null;
      try { fe = w.frameElement; } catch (e) { fe = null; }
      if (!fe) break;
      y += fe.getBoundingClientRect().top;
      w = w.parent;
    }
    return { top: r.top + y, bottom: r.bottom + y };
  }
  // The element of the shell document that holds the field.
  function shellNode(t) {
    var n = t.el, w = t.w;
    for (var i = 0; i < 4 && w !== root; i++) {
      try { n = w.frameElement; w = w.parent; } catch (e) { return null; }
      if (!n) return null;
    }
    return n;
  }
  function unlift() {
    lifted.forEach(function (x) { try { x.el.style.transform = x.old; } catch (e) {} });
    lifted = [];
  }
  // A modal dialog makes the rest of the page inert: the keyboard goes
  // inside it while a field of that dialog is in use.
  function park(t) {
    var n = t ? shellNode(t) : null;
    var dlg = n && n.closest ? n.closest("dialog") : null;
    var modal = false;
    try { modal = !!(dlg && dlg.matches(":modal")); } catch (e) { modal = false; }
    var want = modal ? dlg : doc.body;
    if (box.parentNode !== want) want.appendChild(box);
    parked = modal ? dlg : null;
  }
  function place() {
    if (!st.open || !box) return;
    var t = curTarget();
    park(t);
    var h = box.offsetHeight || 0;
    doc.documentElement.style.setProperty("--osk-h", h + "px");
    if (!t) return;
    var vh = root.innerHeight || doc.documentElement.clientHeight;
    var topEdge = vh - h - 8;
    var r = rectTop(t);
    if (r.bottom <= topEdge && r.top >= 0) return;
    try { t.el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
    r = rectTop(t);
    if (r.bottom <= topEdge) return;
    // Still covered: lift the fixed panel around it (a dialog, the mini
    // Assistant), never the app area, which already ends above us.
    var n = shellNode(t);
    while (n && n !== doc.body && n.nodeType === 1) {
      if (n.id === "oros-running") return;
      var cs = root.getComputedStyle(n);
      if (cs.position === "fixed" || n.tagName === "DIALOG") break;
      n = parentOf(n);
    }
    if (!n || n === doc.body || n.nodeType !== 1) return;
    var by = Math.min(r.bottom - topEdge, Math.max(0, r.top - 48));
    if (by <= 0) return;
    var had = null;
    lifted.forEach(function (x) { if (x.el === n) had = x; });
    if (!had) lifted.push(had = { el: n, old: n.style.transform, by: 0 });
    had.by += by;
    n.style.transform = (had.old ? had.old + " " : "") + "translateY(" + (-had.by) + "px)";
  }

  // ---- Open / close ----
  function show(pinned) {
    if (mode() === "off" && !pinned) return;
    build();
    if (!st.open) {
      st.layer = "abc"; st.shift = 0; st.dead = null;
      st.lay = startLayout(prefs, lang());
    }
    st.open = true;
    st.pinned = !!pinned;
    var t = curTarget();
    if (t) quietNative(t.el);
    render();
    box.hidden = false;
    doc.body.classList.add("osk-open");
    place();
    // A second pass once the frame has its new height.
    setTimeout(place, 60);
    paintBtn();
  }
  function hide() {
    stopRepeat();
    st.open = false; st.pinned = false; st.dead = null;
    if (box) {
      box.hidden = true;
      if (box.parentNode !== doc.body) doc.body.appendChild(box);
    }
    parked = null;
    doc.body.classList.remove("osk-open");
    doc.documentElement.style.removeProperty("--osk-h");
    unlift();
    restoreNative();
    paintBtn();
  }

  // ---- The top-bar button ----
  function paintBtn() {
    var want = !isPhone(env) && mode() !== "off";
    if (!want) { if (btn) { btn.remove(); btn = null; } return; }
    if (!btn) {
      var bar = doc.querySelector(".bar-right");
      if (!bar) return;
      btn = doc.createElement("button");
      btn.id = "osk-btn";
      btn.type = "button";
      btn.innerHTML = SVG.kbd;                       // static icon
      // Keep the field focused: the button never takes the focus.
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("pointerdown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (st.open) hide(); else show(true);
      });
      bar.insertBefore(btn, doc.getElementById("btn-lang"));
    }
    var label = tr(st.open ? "close" : "open");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", st.open ? "true" : "false");
  }

  // ---- Settings (through the shell) ----
  function snapshot() {
    if (isPhone(env)) return null;
    var ls = layoutsOf(prefs, lang());
    return {
      mode: mode(),
      modes: MODES.slice(),
      touch: hasTouch(env),
      layouts: LAYOUT_IDS.map(function (id) { return { id: id, name: LAYOUTS[id].name, on: ls.indexOf(id) !== -1 }; })
    };
  }
  function setPref(name, value) {
    if (name === "mode") {
      if (MODES.indexOf(value) === -1) return false;
      prefs.mode = value;
      if (value === "off" && st.open) hide();
    } else if (/^layout:/.test(name)) {
      var next = withLayout(prefs, lang(), name.slice(7), !!value);
      if (JSON.stringify(next) === JSON.stringify(normPrefs(prefs))) return false;   // the last one stays on
      prefs = next;
      if (layoutsOf(prefs, lang()).indexOf(st.lay) === -1) st.lay = startLayout(prefs, lang());
      if (st.open) render();
    } else return false;
    writePrefs();
    paintBtn();
    if (host && host.changed) host.changed();
    return true;
  }

  function attach(h) {
    if (host) return;
    host = h || {};
    env = readEnv();
    prefs = readPrefs();
    if (isPhone(env)) return;                         // never on phones
    wire(doc);
    doc.addEventListener("load", function (e) {
      var t = e.target;
      if (t && t.tagName === "IFRAME") wireFrame(t);
    }, true);
    Array.prototype.forEach.call(doc.querySelectorAll("iframe"), wireFrame);
    root.addEventListener("resize", function () { if (st.open) setTimeout(place, 60); });
    paintBtn();
  }

  root.orosOsk = {
    VER: VER,
    model: model,
    attach: attach,
    refresh: function () { if (!host || isPhone(env)) return; if (st.open) render(); else paintBtn(); },
    snapshot: snapshot,
    set: setPref,
    watch: function (f) { if (host && !isPhone(env) && f) watch(f); },
    show: function () { if (host && !isPhone(env)) show(true); },
    hide: function () { if (host) hide(); },
    isOpen: function () { return st.open; }
  };
})(typeof window !== "undefined" ? window : globalThis);
