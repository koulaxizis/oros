// ============================================================
// orOS Core — pickers.js: themed pickers (Bible Part VII, PICK-1)
// Keeps the browser's own pickers shut (<select>, date / time, colour)
// and loads pickers-ui.js + pickers-ui.css, which draw the orOS ones,
// on the first press on a field. Kept small for every app's
// first-open budget; the full contract is in pickers-ui.js.
// ============================================================
(function (win) {
  "use strict";
  if (!win || !win.document || win.OrosPick) return;
  var doc = win.document;
  var VERSION = "1.3.0";
  var supported = typeof doc.createElement("dialog").showModal === "function";

  function closestNative(n) { return !!(n.closest && n.closest("[data-native]")); }
  function eligibleSelect(n) {
    return !!n && n.tagName === "SELECT" && !n.multiple && !n.disabled && !(n.size > 1) && !closestNative(n);
  }
  var INPUT_TYPES = { date: 1, time: 1, "datetime-local": 1, color: 1 };
  function eligibleInput(n) {
    return !!n && n.tagName === "INPUT" && !!INPUT_TYPES[n.type] && !n.disabled && !n.readOnly && !closestNative(n);
  }
  function eligible(n) { return eligibleSelect(n) || eligibleInput(n); }
  var FIELDS = 'select, input[type="date"], input[type="time"], input[type="datetime-local"], input[type="color"]';

  // ---------- files: pickers.css now, pickers-ui.* on first use ----------
  var me = doc.currentScript, base = "", query = "";
  if (me && me.src) {
    var m = /^(.*\/)pickers\.js(\?[^#]*)?/.exec(me.src);
    if (m) { base = m[1]; query = m[2] || ""; }
  }
  function link(name, cb) {
    var l = doc.createElement("link");
    l.rel = "stylesheet";
    l.href = base + name + query;
    l.setAttribute("data-opk", name);
    if (cb) { l.onload = cb; l.onerror = cb; }
    (doc.head || doc.documentElement).appendChild(l);
  }
  if (base && supported) {
    link("pickers.css");
    doc.documentElement.classList.add("opk-on");
  }

  var loading = null;
  function ui() { return win.OrosPickUI || null; }
  function load() {
    if (ui()) return Promise.resolve(ui());
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      if (!base) { reject(new Error("pickers: no base")); return; }
      var left = 2;
      function one() { if (--left === 0) { if (ui()) resolve(ui()); else reject(new Error("pickers-ui did not load")); } }
      link("pickers-ui.css", one);
      var s = doc.createElement("script");
      s.src = base + "pickers-ui.js" + query;
      s.onload = one;
      s.onerror = function () { loading = null; reject(new Error("pickers-ui did not load")); };
      (doc.head || doc.documentElement).appendChild(s);
    });
    return loading;
  }
  // Offline with an old cache, or a blocked file: the browser's own
  // picker is better than a field that does nothing (R28).
  function giveBack() {
    doc.documentElement.classList.remove("opk-on");
    supported = false;
  }
  function openField(n) {
    load().then(function (U) { U.open(n); }, giveBack);
  }

  // ---------- opening ----------
  function hit(e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || (t.closest && t.closest("dialog.opk"))) return null;
    if (t.tagName === "SELECT" || t.tagName === "INPUT") return eligible(t) ? t : null;
    var x = e.clientX, y = e.clientY;
    if (typeof x !== "number" || !t.querySelectorAll) return null;
    var list = t.querySelectorAll(FIELDS);
    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];
      if (!eligible(s)) continue;
      var r = s.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }
  var downOn = null;
  function onDown(e) {
    if (!supported || e.button) return;
    var s = hit(e);
    downOn = s;
    if (!s) return;
    load().catch(giveBack);   // start fetching while the finger is down
    e.preventDefault();
    e.stopPropagation();
  }
  function onMouseDown(e) {
    if (supported && !e.button && hit(e)) { e.preventDefault(); e.stopPropagation(); }
  }
  function onClick(e) {
    if (!supported) return;
    var s = hit(e);
    if (!s) return;
    e.preventDefault();
    e.stopPropagation();
    if (s !== downOn && e.detail) return;   // pressed elsewhere, let go here
    downOn = null;
    try { s.focus({ preventScroll: true }); } catch (err) {}
    openField(s);
  }
  function onKey(e) {
    var s = e.target, k = e.key;
    if (!supported || !s || (ui() && ui().isOpen())) return;
    var alt = e.altKey && (k === "ArrowDown" || k === "ArrowUp"), go = false;
    if (eligibleSelect(s)) go = k === " " || k === "Enter" || k === "F4" || alt;
    else if (eligibleInput(s)) {
      if (s.type === "color") go = k === " " || k === "Enter";
      else go = k === "F4" || alt || (k === " " && !e.ctrlKey);
    }
    if (!go) return;
    e.preventDefault();
    e.stopPropagation();
    openField(s);
  }
  function patchShowPicker(proto, ok) {
    var orig = proto && proto.showPicker;
    if (typeof orig !== "function") return;
    proto.showPicker = function () {
      if (supported && ok(this)) { openField(this); return; }
      return orig.apply(this, arguments);
    };
  }
  if (supported && base) {
    patchShowPicker(win.HTMLSelectElement && win.HTMLSelectElement.prototype, eligibleSelect);
    patchShowPicker(win.HTMLInputElement && win.HTMLInputElement.prototype, eligibleInput);
    win.addEventListener("pointerdown", onDown, true);
    win.addEventListener("mousedown", onMouseDown, true);
    win.addEventListener("click", onClick, true);
    win.addEventListener("keydown", onKey, true);
  }

  // ---------- public ----------
  // OrosPick.ask({ text, title?, value?, input?, max?, ok?, cancel?,
  // danger? }) → Promise: true / false, or the typed text / null when
  // `value` or `input` is given (see pickers-ui.js).
  win.OrosPick = {
    VERSION: VERSION,
    eligible: eligible,
    open: function (n) { if (supported && eligible(n)) openField(n); },
    ask: function (o) {
      return load().then(function (U) { return U.ask(o); }, function () {
        giveBack();
        // no themed window could load: answer "no", never a native one (R14)
        return o && (o.input || o.value != null) ? null : false;
      });
    },
    close: function () { if (ui()) ui().close(); },
    isOpen: function () { return !!(ui() && ui().isOpen()); },
    ready: load
  };
})(typeof window !== "undefined" ? window : null);
