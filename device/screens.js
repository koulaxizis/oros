// ============================================================
// orOS — device/screens.js (second screen, wave SS1, v1.0.0)
// "Move to the other screen" for apps and the Slides audience window.
//
// Duplicate or extend is the operating system's choice (Windows: Win+P,
// Live USB: Ctrl+Alt+Shift+D); a page cannot switch it. With extend,
// Chromium (Chrome, Edge, Portable, installed orOS) offers the Window
// Management API: getScreenDetails() lists the screens after a one-time
// permission ("Manage windows on all your displays"), and a window this
// page opened can be moved to another screen. Without the API (Firefox,
// Safari, phones) available() is false and the callers show nothing.
//
// A window opens at once (inside the click, so it is never blocked) on
// the other screen when the screens are already known, else here; it
// moves there as soon as the screens are known (the first time after
// the permission). Nothing is stored: the permission is the browser's.
//
// Pure parts (pickOther, rectOf, features) work in Node for the tests.
//
// API (window.orosScreens, or module.exports under Node):
//   available(win?) -> bool   the API exists and the screen is extended
//   supported(win?) -> bool   the API exists (one screen or more)
//   permission(win?) -> Promise<"granted"|"prompt"|"denied"|"unsupported">
//   details(win?) -> Promise<ScreenDetails|null>  (may ask the permission)
//   known() -> ScreenDetails|null  (cached, never asks)
//   other(win?) -> Promise<ScreenDetailed|null>   a screen this window is not on
//   open(url, name, win?) -> Window|null  opens a window on the other screen
//   place(w, screen) -> bool   moves and sizes a window onto a screen
//   list(win?) -> Promise<[{ label, w, h, primary, current, internal }]>
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Pure ----------
  // The working area of a screen (falls back to the whole screen).
  function rectOf(s) {
    if (!s) return null;
    var num = function (v, d) { v = Number(v); return isFinite(v) ? Math.round(v) : d; };
    var w = num(s.availWidth, num(s.width, 0)), h = num(s.availHeight, num(s.height, 0));
    if (w < 200 || h < 150) return null;
    return { left: num(s.availLeft, num(s.left, 0)), top: num(s.availTop, num(s.top, 0)), width: w, height: h };
  }
  function same(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  }
  // The screen to send a window to: not the current one; a screen that
  // is not built in (a projector, a monitor) first, then the primary,
  // then the first left.
  function pickOther(details) {
    if (!details || !details.screens || details.screens.length < 2) return null;
    var cur = details.currentScreen, list = [];
    for (var i = 0; i < details.screens.length; i++) {
      var s = details.screens[i];
      if (!s || same(s, cur) || !rectOf(s)) continue;
      list.push(s);
    }
    if (!list.length) return null;
    list.sort(function (a, b) {
      var ai = a.isInternal ? 1 : 0, bi = b.isInternal ? 1 : 0;
      if (ai !== bi) return ai - bi;
      var ap = a.isPrimary ? 0 : 1, bp = b.isPrimary ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.left || 0) - (b.left || 0);
    });
    return list[0];
  }
  // window.open features: a window filling the working area of `s`
  // (null: a large window on the current screen).
  function features(s) {
    var r = rectOf(s);
    if (!r) return "popup=yes,width=1100,height=720";
    return "popup=yes,left=" + r.left + ",top=" + r.top + ",width=" + r.width + ",height=" + r.height;
  }

  // ---------- 2. Browser ----------
  var cache = null;          // ScreenDetails (live object, stays current)
  function W(win) { return win || (typeof window !== "undefined" ? window : null); }
  function supported(win) {
    win = W(win);
    return !!(win && typeof win.getScreenDetails === "function");
  }
  function available(win) {
    win = W(win);
    if (!supported(win)) return false;
    try { if (win.screen && win.screen.isExtended === false) return false; } catch (e) {}
    if (cache && cache.screens && cache.screens.length < 2) return false;
    return true;
  }
  function permission(win) {
    win = W(win);
    if (!supported(win)) return Promise.resolve("unsupported");
    var P = win.navigator && win.navigator.permissions;
    if (!P || typeof P.query !== "function") return Promise.resolve("prompt");
    // Chromium before 111 called it "window-placement"
    return P.query({ name: "window-management" }).catch(function () {
      return P.query({ name: "window-placement" });
    }).then(function (r) { return r && r.state ? r.state : "prompt"; }, function () { return "prompt"; });
  }
  function details(win) {
    win = W(win);
    if (!supported(win)) return Promise.resolve(null);
    if (cache) return Promise.resolve(cache);
    var p;
    try { p = win.getScreenDetails(); } catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (d) {
      cache = d || null;
      return cache;
    }, function () { return null; });   // refused: the window stays where it opened
  }
  function known() { return cache; }
  function other(win) {
    return details(win).then(function (d) { return pickOther(d); });
  }
  function place(w, s) {
    var r = rectOf(s);
    if (!w || !r) return false;
    try {
      w.moveTo(r.left, r.top);
      w.resizeTo(r.width, r.height);
      return true;
    } catch (e) { return false; }
  }
  function open(url, name, win) {
    win = W(win);
    var target = cache ? pickOther(cache) : null, w = null;
    try { w = win.open(url, name || "_blank", features(target)); } catch (e) { w = null; }
    if (!w) return null;
    if (!target) {
      other(win).then(function (s) { if (s && !w.closed) place(w, s); });
    }
    return w;
  }
  function list(win) {
    return details(win).then(function (d) {
      if (!d || !d.screens) return [];
      return d.screens.map(function (s) {
        return {
          label: String(s.label || "").slice(0, 80),
          w: Math.round((s.width || 0) * (s.devicePixelRatio || 1)),
          h: Math.round((s.height || 0) * (s.devicePixelRatio || 1)),
          primary: !!s.isPrimary,
          current: same(s, d.currentScreen),
          internal: !!s.isInternal
        };
      });
    });
  }
  // Known already (granted before): fill the cache without asking, so
  // the first window opens straight on the other screen.
  function warm(win) {
    permission(win).then(function (st) { if (st === "granted") details(win); });
  }

  var api = {
    available: available, supported: supported, permission: permission,
    details: details, known: known, other: other, open: open, place: place,
    list: list, warm: warm,
    pickOther: pickOther, rectOf: rectOf, features: features,
    _reset: function () { cache = null; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) {
    root.orosScreens = api;
    try { if (root.top === root) warm(root); } catch (e) {}
  }
})(typeof window !== "undefined" ? window : this);
