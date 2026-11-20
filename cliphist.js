// ============================================================
// orOS — cliphist.js (Clipboard history, shell component, v1.1.0)
// ------------------------------------------------------------
// A shell component, like qsettings.js and widgets.js: it runs IN the
// shell document. shell.js calls attach() once at boot, wire(frame)
// for every app frame it makes, and refresh() after a language change.
// A bundle without this file draws exactly what it drew before.
//
// Chris 2026-11-15 (GNOME gap list, item 8): a clipboard history like
// a desktop's, but only of what is copied INSIDE orOS, opt-in, kept on
// this device only (never synced, never in an export), never anything
// from Passwords, and off while Sensitive work is on.
//
//   • Off by default. Settings › System › Clipboard history turns it
//     on for this device and picks how long a copy is kept (one hour,
//     one day, seven days). Turning it off forgets everything.
//   • What it keeps: plain text copied or cut in an app frame (Ctrl+C,
//     Ctrl+X, the browser's own Copy, and the apps' Copy buttons, which
//     go through navigator.clipboard.writeText / write or a hidden
//     textarea + execCommand("copy")), and the desktop selection
//     menu's Copy (quickmenu.js calls note()). Nothing copied outside
//     orOS is ever read: the system clipboard is never read at all.
//   • What it never keeps: anything from Passwords or Settings (sign-in
//     codes, recovery keys, the sync passphrase), password and one-time
//     code fields, a page or element marked data-oros-noclip, otpauth://
//     links and private keys, and anything while Sensitive work is on
//     or the screen is locked. Turning Sensitive work on forgets the
//     list as well.
//   • Limits: 30 copies, 10 000 characters each, 60 000 together (the
//     oldest go first), so it never takes a real share of the one
//     localStorage every app shares (R30). Pictures are not kept.
//   • The panel (dialog #clip-dlg, centered, R32): Ctrl+Alt+Shift+V
//     (SC_DEFS "v"), the Quick settings button "Clipboard" (only while
//     on) and the desktop menu's "Clipboard history…". A tap copies the
//     text again (and moves it to the top); × forgets one; "Clear all"
//     forgets all of them.
//   • 1.1.0 (W2): pin a copy (at most 10; pinned copies never expire,
//     show first and stay through "Clear all"; turning the history
//     off or Sensitive work on forgets them too); search (every word,
//     case and accents ignored); "Paste into <app>": the text goes into
//     the last text field the person was in, in an app on screen, at
//     its caret, with an input event so the app saves it (never a
//     password or one-time code field); the command bar's "clipboard"
//     / "πρόχειρο" opens the panel (commands/core.js 1.5.0).
//
// Storage (device-local, never synced, not in exports; the factory-
// reset oros-* sweep removes it):
//   oros-cliphist = { v:1, keep:"hour"|"day"|"week", items:[{ t, at, app, p? }] }
//   t = the text, at = ms when copied (unique, newest first), app = the
//   app folder it came from ("" when unknown), p = 1 when pinned (W2).
//   No key = off.
//
// Pure logic is unit-tested in node (tests/cliphist.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.2.0";
  var KEY = "oros-cliphist";
  var KEEPS = { hour: 3600000, day: 86400000, week: 7 * 86400000 };
  var KEEP_DEFAULT = "day";
  var MAX_ITEMS = 30;
  var MAX_ITEM = 10000;          // characters of one copy
  var MAX_TOTAL = 60000;         // characters of all copies together
  var MAX_PINS = 10;             // pinned copies (W2), part of MAX_ITEMS
  // Apps whose copies are never kept: Passwords (passwords, codes, the
  // generator) and Settings (sign-in codes, recovery key, passphrase).
  var SKIP_APPS = { passwords: 1, settings: 1 };

  // ---------- 1. Model (pure) ----------
  function keepOf(k) { return Object.prototype.hasOwnProperty.call(KEEPS, k) ? k : KEEP_DEFAULT; }

  // The stored record → a clean state, or null (= off).
  function parse(raw) {
    var o;
    try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!o || typeof o !== "object" || o.v !== 1) return null;
    var items = [], seen = {};
    (Array.isArray(o.items) ? o.items : []).forEach(function (it) {
      if (!it || typeof it.t !== "string" || typeof it.at !== "number" || !isFinite(it.at)) return;
      var t = clean(it.t);
      if (!t || seen[it.at]) return;
      seen[it.at] = 1;
      var item = { t: t, at: it.at, app: typeof it.app === "string" ? it.app.slice(0, 40) : "" };
      if (it.p === 1) item.p = 1;
      items.push(item);
    });
    items.sort(function (a, b) { return b.at - a.at; });
    return { v: 1, keep: keepOf(o.keep), items: items };
  }

  // A copied text as it is kept, or "" when there is nothing to keep.
  function clean(text) {
    if (typeof text !== "string") return "";
    var t = text.replace(/\r\n?/g, "\n");
    if (!/\S/.test(t)) return "";
    if (t.length > MAX_ITEM) t = t.slice(0, MAX_ITEM);
    return t;
  }

  // Text that is a secret whatever app it came from.
  function secret(text) {
    var t = String(text || "").trim();
    return /^otpauth(-migration)?:\/\//i.test(t) ||
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(t);
  }

  // Expired copies out, then the newest first within the limits.
  // Pinned copies (W2, p: 1) never expire and go first into the
  // limits (at most MAX_PINS: an older pin past that counts as a
  // plain copy); the rest share what is left.
  function prune(st, now) {
    var limit = now - KEEPS[keepOf(st.keep)], total = 0, n = 0, pins = 0, pinned = {}, keep = {};
    st.items.forEach(function (it) {
      if (it.p !== 1 || pins >= MAX_PINS || total + it.t.length > MAX_TOTAL) return;
      pins++; n++; total += it.t.length; pinned[it.at] = keep[it.at] = 1;
    });
    st.items.forEach(function (it) {
      if (pinned[it.at] || it.at < limit || n >= MAX_ITEMS || total + it.t.length > MAX_TOTAL) return;
      n++; total += it.t.length; keep[it.at] = 1;
    });
    var out = [];
    st.items.forEach(function (it) {
      if (!keep[it.at]) return;
      var c = { t: it.t, at: it.at, app: it.app };
      if (pinned[it.at]) c.p = 1;
      out.push(c);
    });
    return { v: 1, keep: keepOf(st.keep), items: out };
  }

  // A new copy at the top; the same text copied again moves up.
  function add(st, text, app, now) {
    var t = clean(text);
    if (!st || !t || secret(t)) return st;
    var at = now;
    st.items.forEach(function (it) { if (it.at >= at) at = it.at + 1; });
    var was = null;
    var items = st.items.filter(function (it) { if (it.t === t) was = it; return it.t !== t; });
    var item = { t: t, at: at, app: typeof app === "string" ? app.slice(0, 40) : "" };
    if (was && was.p === 1) item.p = 1;    // a pinned text copied again stays pinned
    items.unshift(item);
    return prune({ v: 1, keep: st.keep, items: items }, now);
  }

  // Pin or unpin one copy (W2).
  function pin(st, at, on) {
    if (!st) return st;
    return { v: 1, keep: st.keep, items: st.items.map(function (it) {
      var c = { t: it.t, at: it.at, app: it.app };
      if (it.at === at ? on : it.p === 1) c.p = 1;
      return c;
    }) };
  }

  // "Clear all": the pinned copies stay (turning the history off, or
  // Sensitive work, forgets them too).
  function clearKeep(st) {
    if (!st) return st;
    return { v: 1, keep: st.keep, items: st.items.filter(function (it) { return it.p === 1; }) };
  }

  // i18n-inline-ok: the Greek final sigma in fold() is data, not a text to translate.
  // Search (W2): every word of the query in the text, case, accents and
  // final sigma ignored (Greek, German, English).
  function fold(x) {
    return String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/ς/g, "σ").replace(/ß/g, "ss");
  }
  function matches(it, q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var f = fold(it.t);
    return words.every(function (w) { return f.indexOf(w) !== -1; });
  }

  // The list as shown: pinned first, then the newest.
  function shown(st, q) {
    if (!st) return [];
    var list = st.items.filter(function (it) { return matches(it, q); });
    return list.filter(function (it) { return it.p === 1; }).concat(list.filter(function (it) { return it.p !== 1; }));
  }

  function remove(st, at) {
    if (!st) return st;
    return { v: 1, keep: st.keep, items: st.items.filter(function (it) { return it.at !== at; }) };
  }

  // Is a copy from this app folder ever kept?
  function appOk(app) { return !SKIP_APPS[String(app || "")]; }

  // Is the focused element one whose selection must never be kept?
  // (a password or one-time code field, or inside data-oros-noclip)
  function fieldSecret(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest("[data-oros-noclip]")) return true;
    if (String(el.tagName).toUpperCase() !== "INPUT") return false;
    var type = String(el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    return /(^|\s)(one-time-code|current-password|new-password)(\s|$)/.test(ac);
  }

  // The app folder of a path: "/notes/index.html" → "notes".
  function appOfPath(p) {
    var parts = String(p || "").split("/").filter(Boolean);
    if (parts.length && parts[parts.length - 1].indexOf(".") !== -1) parts.pop();
    return parts.length ? parts[parts.length - 1] : "";
  }

  // "now", "5 min", "3 h", "2 d" as a { k, n } string key (k + "1"
  // for one: Greek and German need their own singular).
  function ago(at, now) {
    var s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return { k: "clip.now", n: 0 };
    var n = s < 3600 ? Math.floor(s / 60) : s < 86400 ? Math.floor(s / 3600) : Math.floor(s / 86400);
    var k = s < 3600 ? "clip.min" : s < 86400 ? "clip.hours" : "clip.days";
    return { k: n === 1 ? k + "1" : k, n: n };
  }

  // One line for the list: whitespace runs folded, at most n characters.
  function preview(text, n) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  var model = { VER: VER, KEY: KEY, KEEPS: KEEPS, MAX_ITEMS: MAX_ITEMS, MAX_ITEM: MAX_ITEM, MAX_TOTAL: MAX_TOTAL,
                SKIP_APPS: SKIP_APPS, parse: parse, clean: clean, secret: secret, prune: prune, add: add,
                remove: remove, pin: pin, clearKeep: clearKeep, fold: fold, matches: matches, shown: shown,
                MAX_PINS: MAX_PINS, appOk: appOk, fieldSecret: fieldSecret, appOfPath: appOfPath, ago: ago,
                preview: preview, keepOf: keepOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, dlg = null, listeners = [], warned = false;

  function t(k, vars) {
    var s = typeof root.t === "function" ? root.t(k) : k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(String(vars[n])); });
    return s;
  }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function strictOn() { return !!call(function () { return root.orosStrict && root.orosStrict.level(); }); }
  function locked() { return !!call(function () { return root.orosLock && root.orosLock.isLocked(); }); }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) {}
    return raw ? parse(raw) : null;
  }
  function save(st) {
    try {
      if (st) root.localStorage.setItem(KEY, JSON.stringify(st));
      else root.localStorage.removeItem(KEY);
      warned = false;
    } catch (e) {
      // R30: say it once, never silently.
      if (!warned && host && host.toast) { warned = true; host.toast("err", t("clip.full")); }
      return false;
    }
    changed();
    return true;
  }
  function changed() {
    listeners.forEach(function (fn) { call(fn); });
    if (dlg && dlg.open) paint();
  }

  // The current list, expired copies dropped (and stored dropped).
  function current() {
    var st = load();
    if (!st) return null;
    var p = prune(st, Date.now());
    if (p.items.length !== st.items.length) save(p);
    return p;
  }

  // Keep a copied text (from an app frame, or the shell's own Copy).
  function note(text, app) {
    if (strictOn() || locked() || !appOk(app)) return;
    var st = load();
    if (!st) return;
    var n = add(st, text, app, Date.now());
    if (n !== st) save(n);
  }

  // ---------- 3. Frames ----------
  var lastField = null;    // W2: { w, el, app, frame } the last text field focused in an app
  function editable(f) {
    if (!f || f.nodeType !== 1) return false;
    if (f.isContentEditable) return true;
    if (f.tagName === "TEXTAREA") return !f.readOnly && !f.disabled;
    if (f.tagName !== "INPUT" || f.readOnly || f.disabled) return false;
    return /^(text|search|url|email|tel)?$/i.test(f.getAttribute("type") || "");
  }
  // The field "Paste here" writes into, while it is still there and its
  // app is on screen; else null.
  function pasteTarget() {
    var L = lastField;
    if (!L) return null;
    var ok = call(function () {
      return L.el.isConnected && L.frame.isConnected && L.frame.contentWindow === L.w &&
        L.frame.style.display !== "none" && editable(L.el) && !fieldSecret(L.el);
    });
    if (!ok) { lastField = null; return null; }
    return L;
  }
  // Insert text at the field's caret (replacing what was selected), as
  // typing would: an input event follows, so the app saves it.
  // noFocus (the emoji picker stays open over it): text fields only.
  function pasteInto(L, text, noFocus) {
    var f = L.el, d = L.w.document;
    if (noFocus && f.isContentEditable) return "close";
    if (!noFocus) { try { L.w.focus(); f.focus(); } catch (e) {} }
    if (f.isContentEditable) {
      var ok = false;
      try { ok = d.execCommand("insertText", false, text); } catch (e) {}
      return ok;
    }
    var max = f.maxLength > 0 ? f.maxLength : Infinity;
    var a = f.selectionStart, b = f.selectionEnd;
    if (typeof a !== "number") { a = b = f.value.length; }
    var room = max - (f.value.length - (b - a));
    if (room <= 0) return false;
    var ins = f.tagName === "INPUT" ? text.replace(/\s*\n\s*/g, " ") : text;
    if (ins.length > room) ins = ins.slice(0, room);
    try {
      f.setRangeText(ins, a, b, "end");
      f.dispatchEvent(new L.w.InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: ins }));
    } catch (e) { return false; }
    return true;
  }

  // Every app frame is wired on each load (the shell calls wire() once
  // per frame). Listeners and wrappers do nothing while the history is
  // off, so turning it on works in apps that are already open.
  function wire(frame) {
    if (!frame || frame.__orosClipWired) return;
    frame.__orosClipWired = true;
    frame.addEventListener("load", function () { hook(frame); });
    hook(frame);
  }
  function frameWin(frame) {
    try { var w = frame.contentWindow; return w && w.document ? w : null; } catch (e) { return null; }   // not same-origin
  }
  function hook(frame) {
    var w = frameWin(frame);
    if (!w || w.__orosClipHooked) return;
    var app = call(function () { return appOfPath(w.location.pathname); }) || "";
    if (!app || !appOk(app)) return;
    w.__orosClipHooked = true;
    function noclip() {
      return !!call(function () { return w.document.documentElement.hasAttribute("data-oros-noclip"); });
    }
    // Ctrl+C / Ctrl+X, the browser's Copy, execCommand("copy").
    function onCopy(e) {
      if (!load() || noclip()) return;
      var d = w.document, a = d.activeElement, text = "";
      if (fieldSecret(a)) return;
      if (e.defaultPrevented) {
        // The app wrote the clipboard itself (Spreadsheet, Writer…).
        text = call(function () { return e.clipboardData.getData("text/plain"); }) || "";
      } else if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) {
        text = call(function () { return a.value.slice(a.selectionStart, a.selectionEnd); }) || "";
      } else {
        var sel = call(function () { return w.getSelection(); });
        if (sel) {
          var n = sel.anchorNode;
          n = n && (n.nodeType === 1 ? n : n.parentElement);
          if (fieldSecret(n)) return;
          text = String(sel);
        }
      }
      note(text, app);
    }
    w.addEventListener("copy", onCopy);
    w.addEventListener("cut", onCopy);
    // W2 "Paste here": the last text field the person was in.
    w.addEventListener("focusin", function (e) {
      var f = e.target;
      if (editable(f) && !fieldSecret(f) && !noclip()) lastField = { w: w, el: f, app: app, frame: frame };
    });
    // The apps' Copy buttons: navigator.clipboard.writeText / write.
    var cb = call(function () { return w.navigator.clipboard; });
    if (cb && typeof cb.writeText === "function") {
      var wt = cb.writeText;
      call(function () {
        Object.defineProperty(cb, "writeText", { configurable: true, writable: true, value: function (text) {
          var p = wt.apply(cb, arguments);
          if (load() && !noclip() && !fieldSecret(w.document.activeElement)) {
            Promise.resolve(p).then(function () { note(String(text), app); }, function () {});
          }
          return p;
        } });
      });
    }
    if (cb && typeof cb.write === "function") {
      var wr = cb.write;
      call(function () {
        Object.defineProperty(cb, "write", { configurable: true, writable: true, value: function (items) {
          var p = wr.apply(cb, arguments);
          if (load() && !noclip() && !fieldSecret(w.document.activeElement)) {
            var it = items && items[0];
            if (it && it.types && Array.prototype.indexOf.call(it.types, "text/plain") !== -1) {
              Promise.resolve(p).then(function () { return it.getType("text/plain"); })
                .then(function (b) { return b.text(); })
                .then(function (s) { note(s, app); }, function () {});
            }
          }
          return p;
        } });
      });
    }
  }

  // ---------- 4. The panel ----------
  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC = {
    clip: SV + '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg>',
    x: SV + '<path d="M18 6 6 18M6 6l12 12"/></svg>',
    pin: SV + '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
    paste: SV + '<path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="M12 11v6"/><path d="m9 14 3 3 3-3"/></svg>',
    pocket: SV + '<path d="M4 4h16v7a8 8 0 0 1-16 0z"/><path d="m8.5 10 3.5 3.5 3.5-3.5"/></svg>'   // the Pocket's icon (shell.js POCKET_IC)
  };
  var CSS = [
    "#clip-dlg { width: min(460px, calc(100vw - 24px)); max-height: min(640px, calc(100dvh - 32px)); box-sizing: border-box; padding: 0;",
    "  border: 1px solid var(--border); border-radius: 18px; background: var(--panel-bg, var(--bar-bg)); color: var(--text);",
    "  box-shadow: 0 10px 34px var(--shadow, rgba(0,0,0,.4)); font-size: 14px; }",
    "#clip-dlg[open] { display: flex; flex-direction: column; }",
    "#clip-dlg::backdrop { background: rgba(0,0,0,.35); }",
    "#clip-dlg [hidden] { display: none !important; }",
    ".clip-head { display: flex; align-items: center; gap: 8px; padding: 12px 10px 8px 16px; }",
    ".clip-head h2 { flex: 1; min-width: 0; margin: 0; font-size: 16px; }",
    ".clip-x { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: none;",
    "  border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; }",
    ".clip-x:hover, .clip-x:focus-visible { background: var(--accent-soft); outline: none; }",
    ".clip-x svg { width: 18px; height: 18px; }",
    ".clip-note { margin: 0 16px 10px; font-size: 13px; opacity: .85; }",
    ".clip-list { list-style: none; margin: 0; padding: 0 10px; overflow: auto; flex: 1; min-height: 0; }",
    ".clip-row { display: flex; align-items: stretch; gap: 2px; margin: 0 0 6px; border-radius: 12px; background: var(--accent-soft); }",
    ".clip-use { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 9px 4px 9px 12px; border: none;",
    "  border-radius: 12px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }",
    ".clip-use:hover, .clip-use:focus-visible { background: rgba(127,127,127,.16); outline: none; }",
    ".clip-use span { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow-wrap: anywhere;",
    "  white-space: pre-wrap; }",
    ".clip-use small { font-size: 12px; opacity: .75; }",
    ".clip-row .clip-x { align-self: center; }",
    ".clip-row.pinned { box-shadow: inset 3px 0 0 var(--accent); }",
    ".clip-x.on { color: var(--accent); }",
    ".clip-find { margin: 0 16px 10px; }",
    ".clip-find input { width: 100%; box-sizing: border-box; min-height: 40px; padding: 0 12px; border: 1px solid var(--border);",
    "  border-radius: 999px; background: transparent; color: var(--text); font: inherit; }",
    ".clip-find input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    "@media (max-width: 420px) { .clip-row .clip-x { width: 40px; height: 40px; } .clip-use { padding-left: 10px; } }",
    ".clip-foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding: 10px 16px 14px; }",
    ".clip-foot button { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: transparent;",
    "  color: var(--text); font: inherit; cursor: pointer; }",
    ".clip-foot button.primary { background: var(--accent); border-color: var(--accent); color: var(--clip-on, #fff); }",
    ".clip-foot button:hover, .clip-foot button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }"
  ].join("\n");

  function injectCss() {
    if (doc.getElementById("clip-css")) return;
    var st = doc.createElement("style");
    st.id = "clip-css";
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  var parts = null;
  function build() {
    injectCss();
    dlg = el("dialog");
    dlg.id = "clip-dlg";
    dlg.setAttribute("aria-labelledby", "clip-title");
    var head = el("div", "clip-head");
    var h = el("h2", null, t("clip.title"));
    h.id = "clip-title";
    head.appendChild(h);
    var x = el("button", "clip-x");
    x.type = "button";
    x.innerHTML = IC.x;
    x.setAttribute("aria-label", t("clip.close"));
    x.title = t("clip.close");
    x.addEventListener("click", close);
    head.appendChild(x);
    dlg.appendChild(head);
    var noteP = el("p", "clip-note");
    noteP.setAttribute("role", "status");
    dlg.appendChild(noteP);
    var find = el("div", "clip-find");
    var q = el("input");
    q.type = "search";
    q.setAttribute("aria-label", t("clip.search"));
    q.placeholder = t("clip.search");
    q.setAttribute("autocomplete", "off");
    q.addEventListener("input", function () { paint(); });
    q.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var first = parts && parts.list.querySelector(".clip-use");
      if (first) { e.preventDefault(); first.click(); }
    });
    find.appendChild(q);
    dlg.appendChild(find);
    var list = el("ul", "clip-list");
    dlg.appendChild(list);
    var foot = el("div", "clip-foot");
    var settingsB = footBtn(t("clip.settings"), function () { close(); if (host && host.settings) host.settings("system"); });
    var clearB = footBtn(t("clip.clear"), function () { clear(); });
    var onB = footBtn(t("clip.turnon"), function () { setOn(true); }, true);
    foot.appendChild(settingsB);
    foot.appendChild(clearB);
    foot.appendChild(onB);
    dlg.appendChild(foot);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });   // the backdrop
    var me = dlg;   // Escape closes it too: clean up the same way
    dlg.addEventListener("close", function () { if (dlg === me) close(); });
    parts = { title: h, x: x, note: noteP, find: find, q: q, list: list, settings: settingsB, clear: clearB, on: onB };
    doc.body.appendChild(dlg);
  }
  function footBtn(label, fn, primary) {
    var b = el("button", primary ? "primary" : "", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function appName(id) {
    var n = id && host && host.appName ? call(function () { return host.appName(id); }) : "";
    return n || "";
  }

  function iconBtn(icon, label, fn, on) {
    var b = el("button", "clip-x" + (on ? " on" : ""));
    b.type = "button";
    b.innerHTML = icon;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (on != null) b.setAttribute("aria-pressed", on ? "true" : "false");
    b.addEventListener("click", fn);
    return b;
  }
  // After a row's button changed the list: focus stays near.
  function refocus(sel) {
    var n = parts && (parts.list.querySelector(sel) || parts.list.querySelector(".clip-use"));
    (n || (parts && parts.x) || dlg).focus();
  }

  function paint() {
    if (!dlg || !parts) return;
    var acc = call(function () { return root.orosQS && root.orosQS.model.onAccent(getComputedStyle(dlg).getPropertyValue("--accent")); });
    if (acc) dlg.style.setProperty("--clip-on", acc);
    var strict = strictOn(), st = strict ? null : current(), now = Date.now();
    var tgt = st ? pasteTarget() : null, tgtName = tgt ? appName(tgt.app) : "";
    var q = parts.q.value, list = shown(st, q);
    parts.list.textContent = "";
    var msg = strict ? t("clip.strict") : !load() ? t("clip.off") : !st.items.length ? t("clip.empty") :
      !list.length ? t("clip.nomatch") : tgt ? t("clip.hintPaste", { app: tgtName || t("clip.thisapp") }) : t("clip.hint");
    parts.note.textContent = msg;
    parts.find.hidden = !(st && st.items.length > 1);
    parts.on.hidden = strict || !!load();
    var pins = st ? st.items.filter(function (it) { return it.p === 1; }).length : 0;
    parts.clear.hidden = !(st && st.items.length > pins);
    parts.clear.textContent = t(pins ? "clip.clearRest" : "clip.clear");
    list.forEach(function (it) {
      var li = el("li", "clip-row" + (it.p === 1 ? " pinned" : ""));
      li.setAttribute("data-at", String(it.at));
      var use = el("button", "clip-use");
      use.type = "button";
      use.appendChild(el("span", null, preview(it.t, 400)));
      var a = ago(it.at, now), name = appName(it.app);
      use.appendChild(el("small", null, (it.p === 1 ? t("clip.pinned") + " · " : "") + (name ? name + " · " : "") + t(a.k, { n: a.n })));
      use.setAttribute("aria-label", t("clip.copyit") + ": " + preview(it.t, 80));
      use.addEventListener("click", function () { copyAgain(it); });
      li.appendChild(use);
      if (tgt) {
        li.appendChild(iconBtn(IC.paste, t("clip.paste", { app: tgtName || t("clip.thisapp") }), function () { pasteAgain(it); }));
      }
      var pk = root.orosPocket;
      if (pk && typeof pk.canKeep === "function" && pk.canKeep(it.app)) {     // POCKET-1 W2
        li.appendChild(iconBtn(IC.pocket, t("pk.add"), function () {
          var lk = /^https?:\/\/\S+$/i.test(it.t.trim());
          pk.keep(lk ? "link" : "text", lk ? { url: it.t.trim() } : { text: it.t }, it.app);
        }));
      }
      li.appendChild(iconBtn(IC.pin, t(it.p === 1 ? "clip.unpin" : "clip.pin"), function () {
        var cur = load();
        if (!cur) return;
        var want = it.p !== 1;
        if (want && cur.items.filter(function (x) { return x.p === 1; }).length >= MAX_PINS) {
          if (host && host.toast) host.toast("err", t("clip.pinmax", { n: MAX_PINS }));
          return;
        }
        save(pin(cur, it.at, want));
        refocus('[data-at="' + it.at + '"] .clip-x[aria-pressed]');
      }, it.p === 1));
      li.appendChild(iconBtn(IC.x, t("clip.forget"), function () {
        save(remove(load(), it.at));
        refocus(".clip-use");
      }));
      parts.list.appendChild(li);
    });
  }

  // "Paste here" (W2): into the last text field of the app on screen.
  function pasteAgain(it) {
    var L = pasteTarget();
    if (!L) { paint(); return; }
    lastFocus = null;          // the field gets the focus, not the old one
    close();
    var ok = pasteInto(L, it.t);
    if (!ok && host && host.toast) host.toast("err", t("clip.nopaste"));
  }

  // A tap: the text goes back on the clipboard (a gesture in the shell,
  // so the browser allows it) and moves to the top.
  function copyAgain(it) {
    var text = it.t;
    function done(ok) {
      if (ok) {
        var st = load();
        if (st) save(add(st, text, it.app, Date.now()));   // same text: moves up, keeps its pin
        close();
      }
      if (host && host.toast) host.toast(ok ? "ok" : "err", t(ok ? "clip.copied" : "clip.nocopy"));
    }
    function legacy() {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      (dlg || doc.body).appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) {}
      ta.remove();
      done(ok);
    }
    var cb = root.navigator && root.navigator.clipboard;
    if (cb && typeof cb.writeText === "function") cb.writeText(text).then(function () { done(true); }, legacy);
    else legacy();
  }

  var lastFocus = null;
  function open() {
    if (locked()) return;
    if (dlg && dlg.open) { paint(); return; }
    lastFocus = doc.activeElement;
    build();
    paint();
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    var first = dlg.querySelector(".clip-use") || parts.on;
    if (first && !first.hidden) first.focus(); else parts.x.focus();
  }
  function close() {
    if (!dlg) return;
    var d = dlg;
    if (d.open) { try { d.close(); } catch (e) { d.removeAttribute("open"); } }
    if (d.parentNode) d.parentNode.removeChild(d);
    dlg = null; parts = null;
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) call(function () { lastFocus.focus(); });
  }
  function isOpen() { return !!(dlg && dlg.open); }

  // ---------- 5. Settings ----------
  function setOn(on) {
    if (on && strictOn()) return false;
    if (on) { if (!load()) save({ v: 1, keep: KEEP_DEFAULT, items: [] }); }
    else save(null);
    return true;
  }
  function setKeep(k) {
    var st = load();
    if (!st || !Object.prototype.hasOwnProperty.call(KEEPS, k)) return;
    save(prune({ v: 1, keep: k, items: st.items }, Date.now()));
  }
  // Clear all: the pinned copies stay (W2). wipe(): everything
  // (Sensitive work turned on).
  function clear() {
    var st = load();
    if (st) save(clearKeep(st));
  }
  function wipe() {
    var st = load();
    if (st && st.items.length) save({ v: 1, keep: st.keep, items: [] });
  }
  function snapshot() {
    var st = current();
    return { on: !!st, keep: st ? st.keep : KEEP_DEFAULT, n: st ? st.items.length : 0, strict: strictOn() };
  }

  function attach(h) {
    if (host) return;
    host = h || {};
    // Sensitive work on: the list is forgotten (the switch stays, and
    // nothing is kept until the mode is off again).
    call(function () {
      root.orosStrict.onChange(function () {
        if (strictOn()) wipe();
        changed();
      });
    });
    if (strictOn()) wipe();
    // The desktop menu (quickmenu.js) lists "Clipboard history…" while on.
    (root.__orosDeskItems = root.__orosDeskItems || []).push(function () {
      return load() && !strictOn() ? [{ label: t("clip.desk"), run: open }] : [];
    });
    // Another tab changed it (or a factory reset removed it).
    root.addEventListener("storage", function (e) { if (e.key === KEY || e.key === null) changed(); });
  }

  root.orosClip = {
    VER: VER,
    model: model,
    attach: attach,
    wire: wire,
    note: note,
    open: open,
    close: close,
    isOpen: isOpen,
    toggle: function () { if (isOpen()) close(); else open(); },
    // Settings › System and Quick settings
    snapshot: snapshot,
    isOn: function () { return !!load() && !strictOn(); },
    setOn: setOn,
    setKeep: setKeep,
    clear: clear,
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    },
    // The shell calls this after a language change.
    refresh: function () { if (isOpen()) { close(); open(); } },
    // The last text field in an app on screen (emoji.js, W3):
    // { app, name } or null; insert(text, { keepOpen }) puts text at its
    // caret: true, false, or "close" (a rich text field needs the focus,
    // so the caller closes its dialog and calls insert(text) again).
    field: function () {
      var L = pasteTarget();
      return L ? { app: L.app, name: appName(L.app) } : null;
    },
    insert: function (text, opts) {
      var L = pasteTarget();
      if (!L || typeof text !== "string" || !text) return false;
      return pasteInto(L, text, !!(opts && opts.keepOpen));
    },
    focusField: function () {
      var L = pasteTarget();
      if (L) call(function () { L.w.focus(); L.el.focus(); });
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
