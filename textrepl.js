// ============================================================
// orOS — textrepl.js (Text replacements, shell component, v1.0.0)
// ------------------------------------------------------------
// A shell component, like cliphist.js and quickmenu.js: it runs IN the
// shell document, keeps its own storage and registers its own sync
// slice. shell.js calls attach() once at boot and wire(frame) for every
// app frame it makes. A bundle without this file draws exactly what it
// drew before.
//
// Chris 2026-11-17 (big-OS ideas, item 6, TEXTREPL-1): text
// replacements as on macOS/iOS, Samsung and Gboard. ";addr" followed by
// a space becomes the whole address, in every text field of every
// orOS app, on every device (synced, end to end encrypted like every
// slice).
//
//   • A code (2–32 characters, no spaces) and its text. Typing the code
//     at the start of a word, then a space, a new line or punctuation,
//     replaces the code with the text (card 2: after the delimiter,
//     never in the middle of a word, so ";tel" and ";tel2" both work).
//     Backspace right after it puts the code back (and the browser's
//     own Undo works too: the replacement goes through insertText).
//   • {date} becomes today's date, {time} the time now (in the orOS
//     language), {cursor} is where the caret lands (card 4). When a
//     text has {cursor} and the delimiter was a space, the space is
//     dropped, so the caret sits right at {cursor}.
//   • Where (card 3 and the plan): text, url, email and tel inputs and
//     textareas in app frames (W1; rich text editors come in W2).
//     NEVER: the Passwords and Settings apps; password, hidden and
//     one-time-code fields; search fields (type=search, role=searchbox);
//     code editors (CodeMirror); anything inside data-oros-noexpand or
//     data-oros-noclip; while Sensitive work is on; while the screen is
//     locked; during IME composition. The shell's own fields (search,
//     command bar, smart bar) are never wired: only app frames are.
//   • Not for the Assistant or orOS Gate (card 6): no search provider,
//     no app_summary, no bridge reads this list.
//   • The list is edited in Settings › Language (card 1), through
//     window.orosTextRepl (list, put, remove, onChange).
//
// Data (synced, slice "textrepl", key oros-textrepl):
//   { ver:1, items:[{ id, k, t, m, d }] }
//   • id = random ("r" + base36), k = the code, t = the text,
//     m = ms of the last change to THIS item, d = 1: removed (the item
//     is its own tombstone, k and t emptied).
//   • Limits (R30, one shared localStorage): 500 live items, 4,000
//     characters each, 200,000 together; 500 tombstones (the oldest go
//     first, deterministic: no clock in the merge).
// Merge: union by id; per id the higher m wins, a tie goes to the
//   greater canonical JSON. Items sorted by id, fixed field order, so
//   merge(x, null) == x (SY-L1) and the getter never "moves by itself".
//   Two devices adding the same code: both are kept and Settings says
//   so; the newest one is used until the person removes one.
// Pure logic is unit-tested in node (tests/textrepl.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var KEY = "oros-textrepl";
  var SLICE = "textrepl";
  var MAX_LIVE = 500, MAX_DEAD = 500;
  var MAX_CODE = 32, MIN_CODE = 2;
  var MAX_TEXT = 4000, MAX_TOTAL = 200000;
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  // Apps where nothing is ever replaced: Passwords (secrets) and
  // Settings (the passphrase, sign-in codes and this very editor).
  var SKIP_APPS = { passwords: 1, settings: 1 };
  // What ends a code: white space or punctuation. Greek question mark
  // (U+037E) and ano teleia (U+0387) included; ";" is also the Greek
  // question mark people type, and an opening bracket or quote is
  // allowed before a code.
  var DELIM_RE = /^[\s .,;:!?\)\]\}»”’"'…·;·]$/;
  var OPEN_RE = /^[\(\[\{«“‘"']+/;
  var UNDO_MS = 10000;          // Backspace puts the code back within this

  // ---------- 1. Model (pure) ----------
  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, max) : "";
  }
  // A code as kept: no white space, 2–32 characters, or "".
  function cleanCode(k) {
    if (typeof k !== "string") return "";
    var c = k.normalize ? k.normalize("NFC") : k;
    if (/\s/.test(c) || /[\u0000-\u001f\u007f]/.test(c)) return "";
    if (c.length < MIN_CODE || c.length > MAX_CODE) return "";
    return c;
  }
  function cleanText(t) {
    if (typeof t !== "string") return "";
    var s = t.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
    if (!/\S/.test(s)) return "";
    return s.slice(0, MAX_TEXT);
  }
  function cleanItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id)) return null;
    var m = (typeof it.m === "number" && isFinite(it.m) && it.m >= 0) ? Math.floor(it.m) : 0;
    if (it.d) return { id: it.id, k: "", t: "", m: m, d: 1 };
    var k = cleanCode(it.k), t = cleanText(it.t);
    if (!k || !t) return null;
    return { id: it.id, k: k, t: t, m: m, d: 0 };
  }
  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function byNewest(a, b) { return b.m - a.m || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }

  // The single funnel: load, save, merge output, slice get and set.
  function normalize(data) {
    var byId = {};
    var list = (data && typeof data === "object" && Array.isArray(data.items)) ? data.items : [];
    for (var i = 0; i < list.length; i++) {
      var it = cleanItem(list[i]);
      if (!it) continue;
      byId[it.id] = byId[it.id] ? newer(byId[it.id], it) : it;
    }
    var all = Object.keys(byId).map(function (id) { return byId[id]; });
    var live = all.filter(function (x) { return !x.d; }).sort(byNewest);
    var dead = all.filter(function (x) { return x.d; }).sort(byNewest).slice(0, MAX_DEAD);
    var keep = [], total = 0;
    for (var j = 0; j < live.length && keep.length < MAX_LIVE; j++) {
      if (total + live[j].t.length > MAX_TOTAL) continue;
      total += live[j].t.length;
      keep.push(live[j]);
    }
    var items = keep.concat(dead).sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { ver: 1, items: items };
  }
  function merge(a, b) {
    return normalize({ items: normalize(a).items.concat(normalize(b).items) });
  }

  // i18n-inline-ok: the Greek final sigma in fold() is data, not a text to translate.
  function fold(x) {
    return String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/ς/g, "σ").replace(/ß/g, "ss");
  }
  // The live items as shown: by code (case and accents ignored), then
  // newest first. q: every word in the code or the text.
  function list(data, q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    return normalize(data).items.filter(function (it) {
      if (it.d) return false;
      if (!words.length) return true;
      var f = fold(it.k + " " + it.t);
      return words.every(function (w) { return f.indexOf(w) !== -1; });
    }).sort(function (a, b) {
      var fa = fold(a.k), fb = fold(b.k);
      return fa < fb ? -1 : fa > fb ? 1 : byNewest(a, b);
    });
  }
  // Codes that more than one live item has (two devices added the same).
  function dupes(data) {
    var n = {}, out = {};
    normalize(data).items.forEach(function (it) { if (!it.d) n[it.k] = (n[it.k] || 0) + 1; });
    Object.keys(n).forEach(function (k) { if (n[k] > 1) out[k] = n[k]; });
    return out;
  }
  // code → text, the newest item wins a duplicate code.
  function table(data) {
    var map = {};
    normalize(data).items.filter(function (it) { return !it.d; }).sort(byNewest).forEach(function (it) {
      if (!Object.prototype.hasOwnProperty.call(map, it.k)) map[it.k] = it.t;
    });
    return map;
  }
  // Why an entry cannot be saved: "code" | "space" | "text" | "full" | "" (ok).
  function invalid(data, entry) {
    var k = entry && typeof entry.k === "string" ? entry.k.trim() : "";
    if (/\s/.test(k)) return "space";
    if (!cleanCode(k)) return "code";
    if (!cleanText(entry.t)) return "text";
    var d = normalize(data), live = d.items.filter(function (it) { return !it.d; });
    var cur = null;
    live.forEach(function (it) { if (it.id === entry.id) cur = it; });
    var total = live.reduce(function (s, it) { return s + (it === cur ? 0 : it.t.length); }, 0);
    if ((!cur && live.length >= MAX_LIVE) || total + cleanText(entry.t).length > MAX_TOTAL) return "full";
    return "";
  }
  function newId(rnd) {
    var r = typeof rnd === "function" ? rnd : Math.random;
    return "r" + Date.now().toString(36) + Math.floor(r() * 1e9).toString(36);
  }
  // Add or change one entry; a NEW normalized object (or the same data
  // when it cannot be saved or nothing changes).
  function put(data, entry, now) {
    var d = normalize(data);
    if (!entry || invalid(d, entry)) return d;
    var id = typeof entry.id === "string" && ID_RE.test(entry.id) ? entry.id : newId();
    var k = cleanCode(entry.k.trim()), t = cleanText(entry.t), stored = null;
    d.items.forEach(function (it) { if (it.id === id) stored = it; });
    if (stored && !stored.d && stored.k === k && stored.t === t) return d;
    var item = { id: id, k: k, t: t, m: Math.max(now, stored ? stored.m + 1 : 0), d: 0 };
    return normalize({ items: d.items.filter(function (it) { return it.id !== id; }).concat([item]) });
  }
  function remove(data, id, now) {
    var d = normalize(data), stored = null;
    d.items.forEach(function (it) { if (it.id === id) stored = it; });
    if (!stored || stored.d) return d;
    var dead = { id: id, k: "", t: "", m: Math.max(now, stored.m + 1), d: 1 };
    return normalize({ items: d.items.filter(function (it) { return it.id !== id; }).concat([dead]) });
  }

  // Typing: the text before the caret ends with a delimiter just typed.
  // Returns { start, code, delim } when a code ends right before it at
  // the start of a word, else null.
  function matchAt(value, caret, map) {
    var v = String(value || "");
    if (typeof caret !== "number" || caret < 2 || caret > v.length) return null;
    var delim = v.charAt(caret - 1);
    if (!DELIM_RE.test(delim)) return null;
    var end = caret - 1, start = end;
    while (start > 0 && !/[\s ]/.test(v.charAt(start - 1))) start--;
    var word = v.slice(start, end);
    if (!word) return null;
    if (Object.prototype.hasOwnProperty.call(map, word)) return { start: start, code: word, delim: delim };
    var open = word.match(OPEN_RE);
    if (open) {
      var rest = word.slice(open[0].length);
      if (rest && Object.prototype.hasOwnProperty.call(map, rest)) {
        return { start: start + open[0].length, code: rest, delim: delim };
      }
    }
    return null;
  }

  // The text with its placeholders filled. Returns { text, caret } where
  // caret is the position of {cursor} (-1 when there is none). fmt =
  // { date: "17/11/2026", time: "23:40" }.
  function fill(t, fmt) {
    var s = String(t || "");
    var f = fmt || {};
    s = s.split("{date}").join(f.date || "").split("{time}").join(f.time || "");
    var at = s.indexOf("{cursor}");
    if (at !== -1) s = s.slice(0, at) + s.slice(at + 8).split("{cursor}").join("");
    return { text: s, caret: at };
  }
  // What replaces "code + delimiter": { text, caret } (caret within text).
  function expansion(t, delim, fmt) {
    var r = fill(t, fmt);
    if (r.caret === -1) return { text: r.text + delim, caret: r.text.length + delim.length };
    var tail = /[\s ]/.test(delim) ? "" : delim;
    return { text: r.text + tail, caret: r.caret };
  }
  function stamp(now, lang) {
    var d = new Date(now), L = lang || "en";
    var date = "", time = "";
    try { date = d.toLocaleDateString(L, { day: "numeric", month: "numeric", year: "numeric" }); } catch (e) {}
    try { time = d.toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) {}
    if (!date) date = d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear();
    if (!time) time = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    return { date: date, time: time };
  }

  // The app folder of a path: "/notes/index.html" → "notes".
  function appOfPath(p) {
    var parts = String(p || "").split("/").filter(Boolean);
    if (parts.length && parts[parts.length - 1].indexOf(".") !== -1) parts.pop();
    return parts.length ? parts[parts.length - 1] : "";
  }
  function appOk(app) { return !!app && !SKIP_APPS[String(app)]; }

  // A field codes are replaced in (W1: plain text fields only).
  function fieldOk(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = String(el.tagName).toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    if (el.readOnly || el.disabled) return false;
    if (el.closest && el.closest("[data-oros-noexpand],[data-oros-noclip],.cm-editor,.CodeMirror")) return false;
    if (String(el.getAttribute("role") || "").toLowerCase() === "searchbox") return false;
    if (tag === "INPUT") {
      var type = String(el.getAttribute("type") || "text").toLowerCase();
      if (!/^(text|url|email|tel)$/.test(type)) return false;   // never password, hidden, search, number…
      var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
      if (/(^|\s)(one-time-code|current-password|new-password)(\s|$)/.test(ac)) return false;
    }
    return true;
  }

  var model = { VER: VER, KEY: KEY, SLICE: SLICE, MAX_LIVE: MAX_LIVE, MAX_DEAD: MAX_DEAD, MAX_CODE: MAX_CODE,
                MIN_CODE: MIN_CODE, MAX_TEXT: MAX_TEXT, MAX_TOTAL: MAX_TOTAL, SKIP_APPS: SKIP_APPS,
                cleanCode: cleanCode, cleanText: cleanText, normalize: normalize, merge: merge, list: list,
                dupes: dupes, table: table, invalid: invalid, put: put, remove: remove, matchAt: matchAt,
                fill: fill, expansion: expansion, stamp: stamp, appOfPath: appOfPath, appOk: appOk,
                fieldOk: fieldOk, fold: fold, UNDO_MS: UNDO_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var host = null, listeners = [], warned = false, cache = null;
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function t(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function strictOn() { return !!call(function () { return root.orosStrict && root.orosStrict.level(); }); }
  function locked() { return !!call(function () { return root.orosLock && root.orosLock.isLocked(); }); }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) {}
    var d = null;
    if (raw) { try { d = JSON.parse(raw); } catch (e) { d = null; } }
    return normalize(d);
  }
  function store(d) {
    cache = null;
    try {
      root.localStorage.setItem(KEY, JSON.stringify(d));
      warned = false;
    } catch (e) {
      // R30: say it once, never silently.
      if (!warned && host && host.toast) { warned = true; host.toast("err", t("trp.full")); }
      return false;
    }
    changed();
    return true;
  }
  function changed() { listeners.forEach(function (fn) { call(fn); }); }
  function codes() {
    if (!cache) cache = table(load());
    return cache;
  }
  function markDirty() {
    var api = root.orosSync;
    if (api && typeof api.markDirty === "function") call(function () { api.markDirty(); });
  }

  // Sync: a fresh device sends nothing until the first real change.
  function sliceGet() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) {}
    return raw ? load() : null;
  }
  function sliceSet(data) {
    if (!data) return;
    store(normalize(data));    // no markDirty: pulled data must not re-push
  }
  function registerSync() {
    var api = root.orosSync;
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice(SLICE, sliceGet, sliceSet, KEY, merge);
  }

  // ---------- 3. Frames ----------
  var last = null;   // { el, start, end, caret, undo, value, at } the last replacement
  var busy = false;

  function insertAt(w, f, a, b, text, caret) {
    busy = true;
    try {
      var ok = false;
      try { f.setSelectionRange(a, b); ok = w.document.execCommand("insertText", false, text); } catch (e) { ok = false; }
      if (!ok || f.value.slice(a, a + text.length) !== text) {
        f.setRangeText(text, a, b, "end");
        f.dispatchEvent(new w.InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
      }
      f.setSelectionRange(a + caret, a + caret);
    } catch (e) {} finally { busy = false; }
  }

  function onInput(w, e) {
    if (busy || e.isComposing) return;
    var f = e.target;
    var type = e.inputType || "";
    if (type !== "insertText" && type !== "insertLineBreak") return;
    if (type === "insertText" && (typeof e.data !== "string" || e.data.length !== 1)) return;
    if (!fieldOk(f) || strictOn() || locked()) return;
    var map = codes();
    if (!Object.keys(map).length) return;
    var caret = f.selectionStart;
    if (typeof caret !== "number" || caret !== f.selectionEnd) return;
    var m = matchAt(f.value, caret, map);
    if (!m) return;
    var raw = map[m.code];
    if (f.tagName === "INPUT") raw = raw.replace(/\s*\n\s*/g, " ");    // one line in a one-line field
    var x = expansion(raw, m.delim, stamp(Date.now(), host && host.lang ? host.lang() : "en"));
    var max = f.maxLength > 0 ? f.maxLength : Infinity;
    if (f.value.length - (caret - m.start) + x.text.length > max) return;   // would not fit: leave it
    insertAt(w, f, m.start, caret, x.text, x.caret);
    last = { el: f, start: m.start, end: m.start + x.text.length, caret: m.start + x.caret,
             undo: m.code + m.delim, value: f.value, at: Date.now() };
  }
  // Backspace right after a replacement puts the code back.
  function onBeforeInput(w, e) {
    if (!last || e.inputType !== "deleteContentBackward" || e.target !== last.el) return;
    var L = last, f = L.el;
    last = null;
    if (Date.now() - L.at > UNDO_MS || f.value !== L.value) return;
    if (f.selectionStart !== L.caret || f.selectionEnd !== L.caret) return;
    e.preventDefault();
    insertAt(w, f, L.start, L.end, L.undo, L.undo.length);
  }

  function frameWin(frame) {
    try { var w = frame.contentWindow; return w && w.document ? w : null; } catch (e) { return null; }   // not same-origin
  }
  function hook(frame) {
    var w = frameWin(frame);
    if (!w || w.__orosReplHooked) return;
    var app = call(function () { return appOfPath(w.location.pathname); }) || "";
    if (!appOk(app)) return;
    w.__orosReplHooked = true;
    w.addEventListener("input", function (e) { onInput(w, e); }, true);
    w.addEventListener("beforeinput", function (e) { onBeforeInput(w, e); }, true);
    // Anything else typed, clicked or focused ends the undo window.
    w.addEventListener("focusout", function () { last = null; }, true);
  }
  // Every app frame is wired on each load (the shell calls wire() once
  // per frame). The listeners do nothing while the list is empty.
  function wire(frame) {
    if (!frame || frame.__orosReplWired) return;
    frame.__orosReplWired = true;
    frame.addEventListener("load", function () { hook(frame); });
    hook(frame);
  }

  // ---------- 4. Public API ----------
  // host = { lang() → "en"|"el"|"de", toast(kind, msg) }
  function attach(h) {
    if (host) return;
    host = h || {};
    registerSync();
    root.addEventListener("storage", function (e) { if (e.key === KEY) { cache = null; changed(); } });
  }
  function edit(next) {
    var cur = load();
    if (JSON.stringify(next) === JSON.stringify(cur)) return true;
    if (!store(next)) return false;
    markDirty();
    return true;
  }

  root.orosTextRepl = {
    VER: VER,
    model: model,
    attach: attach,
    wire: wire,
    // Settings › Language
    list: function (q) { return list(load(), q); },
    dupes: function () { return dupes(load()); },
    invalid: function (entry) { return invalid(load(), entry); },
    put: function (entry) {
      var d = load(), why = invalid(d, entry);
      if (why) return why;
      return edit(put(d, entry, Date.now())) ? "" : "store";
    },
    remove: function (id) { return edit(remove(load(), id, Date.now())); },
    paused: function () { return strictOn(); },
    limits: { live: MAX_LIVE, code: MAX_CODE, text: MAX_TEXT },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
