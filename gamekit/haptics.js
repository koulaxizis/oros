// ============================================================
// orOS gamekit/haptics.js — optional vibration in the games (v1.0.0)
// Games audit F8 (2026-11-05). NOT an app: a plain script every game
// loads next to its own files:
//
//   <script src="../gamekit/haptics.js"></script>
//
// It only defines window.orosHaptics. Off by default; the Game Center
// turns it on for this device (device-local key oros-games-haptics,
// "1" = on; never synced, a phone wants it and a laptop has no motor).
// Where the browser has no navigator.vibrate (iPhone) or no touch
// screen (desktops) it does nothing.
//
// API (window.orosHaptics, or module.exports in Node):
//   KEY                    "oros-games-haptics"
//   supported() → bool     navigator.vibrate on a touch screen
//   enabled() → bool       supported and switched on here
//   set(on)                switch it on / off on this device
//   pattern(kind) → [ms]   the buzz for a game's sound cue ([] = none)
//   cue(kind)              buzz for that cue, if enabled; at most one
//                          buzz every 60 ms so fast games do not drone
// A game calls cue() from its sfx(kind) (before its own mute check,
// so the sound and the vibration are switched separately), or at its
// own moments when it has no sounds: "win" when solved, "miss" for a
// wrong move, anything else for a plain move.
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-games-haptics";
  var WIN = /^(win|won|solved|level|king)$/;
  var BAD = /^(miss|no|boom|over|lost|lose|end|bad|wrong)$/;
  var SKIP = /^(tick|hint|shuffle|roll)$/;        // the game's own clock or a helper, not a move
  var GAP = 60;
  var last = 0;

  function nav() { return root && root.navigator; }
  // a touch screen with navigator.vibrate (desktop Chrome has the call but no motor)
  function supported() {
    var n = nav();
    if (!(n && typeof n.vibrate === "function")) return false;
    try { return !root.matchMedia || root.matchMedia("(pointer: coarse)").matches; } catch (e) { return true; }
  }
  function read() { try { return root.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function enabled() { return supported() && read(); }
  function set(on) {
    try {
      if (on) root.localStorage.setItem(KEY, "1"); else root.localStorage.removeItem(KEY);
    } catch (e) {}
  }

  function pattern(kind) {
    var k = String(kind || "");
    if (SKIP.test(k)) return [];
    if (WIN.test(k)) return [25, 50, 25, 50, 60];
    if (BAD.test(k)) return [70];
    return [12];
  }

  function cue(kind) {
    if (!enabled()) return;
    var p = pattern(kind);
    if (!p.length) return;
    var now = Date.now();
    if (p.length === 1 && p[0] < 20 && now - last < GAP) return;
    last = now;
    try { nav().vibrate(p); } catch (e) {}
  }

  var api = { KEY: KEY, supported: supported, enabled: enabled, set: set, pattern: pattern, cue: cue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosHaptics = api;
})(typeof window !== "undefined" ? window : this);
