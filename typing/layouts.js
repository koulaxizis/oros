// ============================================================
// orOS Typing Tutor: keyboard layouts (pure, no DOM)
// i18n-inline-ok: the Greek and German letters below are keyboard layout data (keys and dead keys), no UI text
// Each layout lists its physical rows by KeyboardEvent.code, the
// character of each key (normal, Shift) and the dead keys. Fingers are
// the same for every layout (they follow the physical key).
//   en: US QWERTY (ANSI)
//   el: Greek (Windows / Linux "gr", based on US): ; is the dead key
//       for the tonos, Shift+; for the dialytika
//   de: German QWERTZ (ISO, T1)
// Loaded by index.html and by Node in the tests.
// ============================================================
(function (root) {
  "use strict";

  // Finger ids: l/r hand + p pinky, r ring, m middle, i index; th thumbs.
  var FINGERS = ["lp", "lr", "lm", "li", "ri", "rm", "rr", "rp", "th"];
  var FINGER_OF = {
    Backquote: "lp", Digit1: "lp", KeyQ: "lp", KeyA: "lp", KeyZ: "lp", IntlBackslash: "lp", ShiftLeft: "lp",
    Digit2: "lr", KeyW: "lr", KeyS: "lr", KeyX: "lr",
    Digit3: "lm", KeyE: "lm", KeyD: "lm", KeyC: "lm",
    Digit4: "li", Digit5: "li", KeyR: "li", KeyT: "li", KeyF: "li", KeyG: "li", KeyV: "li", KeyB: "li",
    Digit6: "ri", Digit7: "ri", KeyY: "ri", KeyU: "ri", KeyH: "ri", KeyJ: "ri", KeyN: "ri", KeyM: "ri",
    Digit8: "rm", KeyI: "rm", KeyK: "rm", Comma: "rm",
    Digit9: "rr", KeyO: "rr", KeyL: "rr", Period: "rr",
    Digit0: "rp", Minus: "rp", Equal: "rp", KeyP: "rp", BracketLeft: "rp", BracketRight: "rp",
    Backslash: "rp", Semicolon: "rp", Quote: "rp", Slash: "rp", ShiftRight: "rp",
    Space: "th"
  };
  function fingerOf(code) { return FINGER_OF[code] || ""; }
  function handOf(code) { var f = fingerOf(code); return f === "th" ? "" : f.charAt(0); }

  var DIGITS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];
  var TOP = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"];
  var HOME = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"];
  var BOTTOM = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"];

  // keys: code → [normal, shift]; a value that starts with "dead:" is a
  // dead key (it types nothing itself and changes the next letter).
  function mapRow(codes, normal, shift) {
    var out = {};
    var n = Array.from(normal), s = Array.from(shift);
    codes.forEach(function (c, i) { out[c] = [n[i], s[i]]; });
    return out;
  }
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      Object.keys(src).forEach(function (k) { target[k] = src[k]; });
    }
    return target;
  }

  var US_DIGITS = mapRow(["Backquote"].concat(DIGITS, ["Minus", "Equal"]), "`1234567890-=", "~!@#$%^&*()_+");

  var LAYOUTS = {
    en: {
      id: "en", lang: "en", name: "English (US)", short: "EN", iso: false,
      rows: [
        ["Backquote"].concat(DIGITS, ["Minus", "Equal"]),
        TOP.concat(["BracketLeft", "BracketRight", "Backslash"]),
        HOME.concat(["Semicolon", "Quote"]),
        ["ShiftLeft"].concat(BOTTOM, ["ShiftRight"])
      ],
      keys: assign({}, US_DIGITS,
        mapRow(TOP.concat(["BracketLeft", "BracketRight", "Backslash"]), "qwertyuiop[]\\", "QWERTYUIOP{}|"),
        mapRow(HOME.concat(["Semicolon", "Quote"]), "asdfghjkl;'", "ASDFGHJKL:\""),
        mapRow(BOTTOM, "zxcvbnm,./", "ZXCVBNM<>?")),
      dead: {}
    },
    el: {
      id: "el", lang: "el", name: "Ελληνικά", short: "ΕΛ", iso: false,
      rows: [
        ["Backquote"].concat(DIGITS, ["Minus", "Equal"]),
        TOP.concat(["BracketLeft", "BracketRight", "Backslash"]),
        HOME.concat(["Semicolon", "Quote"]),
        ["ShiftLeft"].concat(BOTTOM, ["ShiftRight"])
      ],
      keys: assign({}, US_DIGITS,
        mapRow(TOP.concat(["BracketLeft", "BracketRight", "Backslash"]), ";ςερτυθιοπ[]\\", ":ΣΕΡΤΥΘΙΟΠ{}|"),
        mapRow(HOME, "ασδφγηξκλ", "ΑΣΔΦΓΗΞΚΛ"),
        { Semicolon: ["dead:tonos", "dead:dial"], Quote: ["'", "\""] },
        mapRow(BOTTOM, "ζχψωβνμ,./", "ΖΧΨΩΒΝΜ<>?")),
      dead: {
        tonos: { "α": "ά", "ε": "έ", "η": "ή", "ι": "ί", "ο": "ό", "υ": "ύ", "ω": "ώ",
                 "Α": "Ά", "Ε": "Έ", "Η": "Ή", "Ι": "Ί", "Ο": "Ό", "Υ": "Ύ", "Ω": "Ώ" },
        dial: { "ι": "ϊ", "υ": "ϋ", "Ι": "Ϊ", "Υ": "Ϋ" }
      }
    },
    de: {
      id: "de", lang: "de", name: "Deutsch", short: "DE", iso: true,
      rows: [
        ["Backquote"].concat(DIGITS, ["Minus", "Equal"]),
        TOP.concat(["BracketLeft", "BracketRight"]),
        HOME.concat(["Semicolon", "Quote", "Backslash"]),
        ["ShiftLeft", "IntlBackslash"].concat(BOTTOM, ["ShiftRight"])
      ],
      keys: assign({},
        mapRow(DIGITS, "1234567890", "!\"§$%&/()="),
        { Backquote: ["dead:circ", "°"], Minus: ["ß", "?"], Equal: ["dead:acute", "dead:grave"] },
        mapRow(TOP.concat(["BracketLeft", "BracketRight"]), "qwertzuiopü+", "QWERTZUIOPÜ*"),
        mapRow(HOME.concat(["Semicolon", "Quote", "Backslash"]), "asdfghjklöä#", "ASDFGHJKLÖÄ'"),
        mapRow(["IntlBackslash"].concat(BOTTOM), "<yxcvbnm,.-", ">YXCVBNM;:_")),
      dead: {
        circ: {}, acute: {}, grave: {}
      }
    }
  };
  var LAYOUT_IDS = ["el", "en", "de"];

  function get(id) { return LAYOUTS[id] || LAYOUTS.en; }

  // Every code on the screen keyboard of a layout, in row order.
  function codes(lay) {
    var L = get(lay), out = [];
    L.rows.forEach(function (r) { r.forEach(function (c) { out.push(c); }); });
    return out;
  }

  // char → the keys to press, in order: [{code, shift}] (a dead key
  // first for a composed letter, the Shift on the other hand). Space is
  // {code:"Space"}. Unknown character → null.
  var REV_CACHE = {};
  function reverse(lay) {
    if (REV_CACHE[lay]) return REV_CACHE[lay];
    var L = get(lay), rev = {}, deadKey = {};
    Object.keys(L.keys).forEach(function (code) {
      L.keys[code].forEach(function (ch, i) {
        if (!ch) return;
        if (ch.indexOf("dead:") === 0) { deadKey[ch.slice(5)] = { code: code, shift: i === 1 }; return; }
        if (!rev[ch]) rev[ch] = [{ code: code, shift: i === 1 }];
      });
    });
    Object.keys(L.dead).forEach(function (name) {
      var dk = deadKey[name];
      if (!dk) return;
      Object.keys(L.dead[name]).forEach(function (base) {
        var out = L.dead[name][base];
        if (!rev[out] && rev[base]) rev[out] = [dk].concat(rev[base]);
      });
    });
    rev[" "] = [{ code: "Space", shift: false }];
    REV_CACHE[lay] = rev;
    return rev;
  }
  function strokes(lay, ch) {
    var r = reverse(lay)[String(ch).normalize("NFC")];
    return r ? r.map(function (s) { return { code: s.code, shift: s.shift }; }) : null;
  }
  // The Shift key for a stroke: the one on the other hand.
  function shiftFor(code) { return handOf(code) === "l" ? "ShiftRight" : "ShiftLeft"; }

  // Every character a layout types (dead-key compositions included).
  function chars(lay) { return Object.keys(reverse(lay)); }

  // What a layout shows on a key cap: [normal, shift], dead keys as
  // their mark (´ ¨ ^ ` ).
  var DEAD_MARK = { tonos: "΄", dial: "¨", circ: "^", acute: "´", grave: "`" };
  function cap(lay, code) {
    var k = get(lay).keys[code];
    if (!k) return null;
    return k.map(function (ch) { return ch && ch.indexOf("dead:") === 0 ? DEAD_MARK[ch.slice(5)] || "" : ch; });
  }

  // A key press (code + the character the system typed) → which of our
  // layouts gives that character on that key, or "" when none or when
  // the press says nothing (Space, digits that are the same everywhere).
  function guess(code, key, shift) {
    var hits = fits(code, key, shift);
    return hits.length === 1 ? hits[0] : "";
  }
  // Every layout that gives `key` on `code` ([] when the press says
  // nothing: no code, a key name, an unknown key).
  function fits(code, key, shift) {
    if (!code || typeof key !== "string" || Array.from(key).length !== 1) return [];
    return LAYOUT_IDS.filter(function (id) {
      var k = LAYOUTS[id].keys[code];
      return k && k[shift ? 1 : 0] === key;
    });
  }

  var API = {
    FINGERS: FINGERS, LAYOUT_IDS: LAYOUT_IDS, LAYOUTS: LAYOUTS,
    get: get, codes: codes, strokes: strokes, chars: chars, cap: cap, guess: guess, fits: fits,
    fingerOf: fingerOf, handOf: handOf, shiftFor: shiftFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TypingLayouts = API;
})(typeof window !== "undefined" ? window : globalThis);
