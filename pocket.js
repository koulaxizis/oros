// ============================================================
// orOS — pocket.js (the Pocket, shell component, v1.0.0, POCKET-1)
// ------------------------------------------------------------
// Chris 2026-11-17 (big-OS ideas round, item 11: ChromeOS Holding
// space, HarmonyOS Super Hub, macOS Stacks); name «Τσέπη» / "Pocket" /
// "Ablage", decided 2026-11-18 (the Greek «Ράφι» is Media Shelf's).
//
// A small holding place of the shell: keep a text, a link, a list, a
// table or files on the orOS disk from any app, close the app, open
// another, and send it there from the Pocket. Sending goes through the
// existing "Send to an app" sheet (send/, BR-SEND): the app that takes
// it opens a prefill the person still has to save (BR-W8-6). No app
// learns a new way of receiving.
//
//   • In: "Keep in pocket" in the Send sheet (every app with Send…
//     gets it) and in the desktop selection menu (quickmenu.js).
//   • Out: "Send…" on a row opens the Send sheet with that item; the
//     item stays, so it can go to a second app too. × removes one,
//     "Empty the pocket" removes all.
//   • Files are kept as their /internal path only (never a copy); a
//     file moved or deleted since shows "Not found".
//   • The button (Dock end, or the top bar when no Dock is on screen)
//     shows only while the Pocket holds something (Chris 2026-11-18).
//     The button itself lives in shell.js; this file loads on first
//     use (Keep, or opening the panel), never at boot.
//
// Never: anything from Passwords or Settings, text that is a secret
// (otpauth://, private keys: the clipboard history's own check), and
// anything while Sensitive work is on or the screen is locked. Turning
// Sensitive work on empties the Pocket (shell.js does that, so it
// works before this file has loaded).
//
// Storage (device-local, never synced, not in exports or backups; the
// factory-reset oros-* sweep removes it):
//   oros-pocket = { v:1, items:[{ at, k, d, app }] }
//   at = ms when kept (unique, newest first), k = a send/core.js kind
//   (text | link | items | table | files), d = its data as
//   OrosSendCore.norm returns it, app = the app folder it came from.
//   Kept until removed (Chris 2026-11-18): at most 20 items, one at
//   most 20 000 characters of JSON, 100 000 together; the oldest go.
//
// Pure logic is unit-tested in node (tests/pocket.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var KEY = "oros-pocket";
  var MAX_ITEMS = 20;
  var MAX_ITEM = 20000;          // characters of one item's data (JSON)
  var MAX_TOTAL = 100000;        // characters of all items together
  var KINDS = { text: 1, link: 1, items: 1, table: 1, files: 1 };
  // Apps whose items never go in: Passwords and Settings (as the
  // clipboard history).
  var SKIP_APPS = { passwords: 1, settings: 1 };

  // ---------- 1. Model (pure) ----------
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function appId(a) { return typeof a === "string" && /^[a-z0-9-]{1,40}$/.test(a) ? a : ""; }
  function sizeOf(d) { try { return JSON.stringify(d).length; } catch (e) { return Infinity; } }

  // The stored record → a clean state (never null: an empty pocket).
  // norm = OrosSendCore.norm: every item is normalized again on read.
  function parse(raw, norm) {
    var o;
    try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
    var items = [], seen = {};
    if (o && typeof o === "object" && o.v === 1 && Array.isArray(o.items)) {
      o.items.forEach(function (it) {
        if (!it || typeof it !== "object" || typeof it.at !== "number" || !isFinite(it.at) || seen[it.at]) return;
        if (typeof it.k !== "string" || !own(KINDS, it.k)) return;
        var d = typeof norm === "function" ? norm(it.k, it.d) : it.d;
        if (!d || typeof d !== "object" || sizeOf(d) > MAX_ITEM) return;
        seen[it.at] = 1;
        items.push({ at: it.at, k: it.k, d: d, app: appId(it.app) });
      });
    }
    items.sort(function (a, b) { return b.at - a.at; });
    return prune({ v: 1, items: items });
  }

  // The newest first within the limits.
  function prune(st) {
    var total = 0, out = [];
    st.items.forEach(function (it) {
      var n = sizeOf(it.d);
      if (out.length >= MAX_ITEMS || total + n > MAX_TOTAL) return;
      total += n;
      out.push(it);
    });
    return { v: 1, items: out };
  }

  // An item's plain text (Copy, and the secret check).
  function plain(k, d) {
    if (k === "text") return (d.title ? d.title + "\n" : "") + d.text;
    if (k === "link") return d.url;
    if (k === "items") return d.items.map(function (it) { return it.text + (it.note ? " (" + it.note + ")" : ""); }).join("\n");
    if (k === "files") return d.items.map(function (f) { return f.path; }).join("\n");
    return d.rows.map(function (r) { return r.join("\t"); }).join("\n");
  }

  // Text that is a secret whatever app it came from: the clipboard
  // history's check (cliphist.js) when the shell has it.
  function secret(text) {
    var C = root.orosClip && root.orosClip.model;
    if (C && typeof C.secret === "function") return C.secret(text);
    var t = String(text || "").trim();
    return /^otpauth(-migration)?:\/\//i.test(t) || /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(t);
  }
  function appOk(app) { return !SKIP_APPS[String(app || "")]; }

  // Keep one (d already normalized). The same item kept again moves to
  // the top. → { st, err } with err "" | "app" | "kind" | "big" | "secret".
  function add(st, k, d, app, now) {
    if (!appOk(app)) return { st: st, err: "app" };
    if (!own(KINDS, k) || !d || typeof d !== "object") return { st: st, err: "kind" };
    if (sizeOf(d) > MAX_ITEM) return { st: st, err: "big" };
    if (secret(plain(k, d))) return { st: st, err: "secret" };
    var key = k + "\u0000" + JSON.stringify(d), at = now;
    st.items.forEach(function (it) { if (it.at >= at) at = it.at + 1; });
    var items = st.items.filter(function (it) { return it.k + "\u0000" + JSON.stringify(it.d) !== key; });
    items.unshift({ at: at, k: k, d: d, app: appId(app) });
    return { st: prune({ v: 1, items: items }), err: "" };
  }

  function remove(st, at) {
    return { v: 1, items: st.items.filter(function (it) { return it.at !== at; }) };
  }
  function find(st, at) {
    for (var i = 0; i < st.items.length; i++) if (st.items[i].at === at) return st.items[i];
    return null;
  }

  var model = { VER: VER, KEY: KEY, MAX_ITEMS: MAX_ITEMS, MAX_ITEM: MAX_ITEM, MAX_TOTAL: MAX_TOTAL,
                SKIP_APPS: SKIP_APPS, parse: parse, prune: prune, add: add, remove: remove, find: find,
                plain: plain, secret: secret, appOk: appOk, sizeOf: sizeOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  // host (shell.js): { toast(kind, msg), appName(id), send(item),
  //   stat(path) → Promise, strict() → bool, locked() → bool,
  //   settings(section), changed() }
  var doc = document;
  var host = null, dlg = null, parts = null, lastFocus = null;

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
  function toast(kind, msg) { if (host && host.toast) call(function () { host.toast(kind, msg); }); }
  function S() { return root.OrosSendCore || null; }
  function lang() { var l = String(root.orosLang || "en"); return l === "el" ? "el" : "en"; }

  function load() {
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) {}
    var C = S();
    return parse(raw, C ? C.norm : null);
  }
  function save(st) {
    try {
      if (st.items.length) root.localStorage.setItem(KEY, JSON.stringify(st));
      else root.localStorage.removeItem(KEY);
    } catch (e) {
      toast("err", t("pk.nofit"));     // R30: never silently
      return false;
    }
    if (host && host.changed) call(host.changed);
    if (dlg && dlg.open) paint();
    return true;
  }
  function strictOn() { return !!(host && host.strict && call(host.strict)); }
  function locked() { return !!(host && host.locked && call(host.locked)); }

  // Keep one item. → true when it is in the Pocket.
  function keep(kind, data, app) {
    if (strictOn() || locked()) { toast("err", t("pk.strict")); return false; }
    var C = S(), d = C ? C.norm(kind, data) : null;
    if (!d) { toast("err", t("pk.failed")); return false; }
    var r = add(load(), kind, d, app, Date.now());
    if (r.err) { toast("err", t(r.err === "big" ? "pk.big" : r.err === "secret" ? "pk.secret" : "pk.failed")); return false; }
    if (!save(r.st)) return false;
    toast("ok", t("pk.kept"));
    return true;
  }

  // ---------- 3. The panel ----------
  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC = {
    x: SV + '<path d="M18 6 6 18M6 6l12 12"/></svg>',
    copy: SV + '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    send: SV + '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
    text: SV + '<path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    link: SV + '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    items: SV + '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    table: SV + '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>',
    files: SV + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'
  };
  var CSS = [
    "#pk-dlg { width: min(460px, calc(100vw - 24px)); max-height: min(640px, calc(100dvh - 32px)); box-sizing: border-box; padding: 0;",
    "  border: 1px solid var(--border); border-radius: 18px; background: var(--panel-bg, var(--bar-bg)); color: var(--text);",
    "  box-shadow: 0 10px 34px var(--shadow, rgba(0,0,0,.4)); font-size: 14px; }",
    "#pk-dlg[open] { display: flex; flex-direction: column; }",
    "#pk-dlg::backdrop { background: rgba(0,0,0,.35); }",
    "#pk-dlg [hidden] { display: none !important; }",
    ".pk-head { display: flex; align-items: center; gap: 8px; padding: 12px 10px 8px 16px; }",
    ".pk-head h2 { flex: 1; min-width: 0; margin: 0; font-size: 16px; }",
    ".pk-b { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: none;",
    "  border-radius: 50%; background: transparent; color: var(--text); cursor: pointer; }",
    ".pk-b:hover, .pk-b:focus-visible { background: var(--accent-soft); outline: none; }",
    ".pk-b:disabled { opacity: .4; cursor: default; background: transparent; }",
    ".pk-b svg { width: 18px; height: 18px; }",
    ".pk-note { margin: 0 16px 10px; font-size: 13px; opacity: .85; }",
    ".pk-list { list-style: none; margin: 0; padding: 0 10px; overflow: auto; flex: 1; min-height: 0; }",
    ".pk-row { display: flex; align-items: center; gap: 2px; margin: 0 0 6px; border-radius: 12px; background: var(--accent-soft); }",
    ".pk-use { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 9px 4px 9px 12px; border: none;",
    "  border-radius: 12px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }",
    ".pk-use:hover, .pk-use:focus-visible { background: rgba(127,127,127,.16); outline: none; }",
    ".pk-use:disabled { cursor: default; background: transparent; }",
    ".pk-row[draggable=true] .pk-use { cursor: grab; }",
    ".pk-ic { flex: none; width: 22px; height: 22px; color: var(--accent); }",
    ".pk-ic svg { width: 22px; height: 22px; }",
    ".pk-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }",
    ".pk-tx span { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }",
    ".pk-tx small { font-size: 12px; opacity: .75; }",
    ".pk-row.pk-gone .pk-tx span { text-decoration: line-through; opacity: .7; }",
    ".pk-row.pk-gone .pk-tx small { color: var(--danger); opacity: 1; }",
    "@media (max-width: 420px) { .pk-row .pk-b { width: 40px; height: 40px; } .pk-use { padding-left: 10px; gap: 8px; } }",
    ".pk-foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding: 10px 16px 14px; }",
    ".pk-foot button { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: transparent;",
    "  color: var(--text); font: inherit; cursor: pointer; }",
    ".pk-foot button:hover, .pk-foot button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }",
    "@media (max-width: 560px) { #pk-dlg { margin: auto auto 0; width: 100vw; max-width: 100vw; border-radius: 18px 18px 0 0;",
    "  padding-bottom: env(safe-area-inset-bottom, 0px); } }"
  ].join("\n");

  function injectCss() {
    if (doc.getElementById("pk-css")) return;
    var st = doc.createElement("style");
    st.id = "pk-css";
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function iconBtn(icon, label, fn) {
    var b = el("button", "pk-b");
    b.type = "button";
    b.innerHTML = icon;              // static shell icon, never data
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }
  function footBtn(label, fn) {
    var b = el("button", "", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function build() {
    injectCss();
    dlg = el("dialog");
    dlg.id = "pk-dlg";
    dlg.setAttribute("aria-labelledby", "pk-title");
    var head = el("div", "pk-head");
    var h = el("h2", null, t("pk.title"));
    h.id = "pk-title";
    head.appendChild(h);
    var x = iconBtn(IC.x, t("pk.close"), close);
    head.appendChild(x);
    dlg.appendChild(head);
    var note = el("p", "pk-note");
    note.setAttribute("role", "status");
    dlg.appendChild(note);
    var list = el("ul", "pk-list");
    dlg.appendChild(list);
    var foot = el("div", "pk-foot");
    var clearB = footBtn(t("pk.clear"), function () { clear(); });
    foot.appendChild(clearB);
    dlg.appendChild(foot);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });   // the backdrop
    var me = dlg;
    dlg.addEventListener("close", function () { if (dlg === me && !dragging) close(); });

    parts = { x: x, note: note, list: list, clear: clearB };
    doc.body.appendChild(dlg);
  }

  function appName(id) {
    return (id && host && host.appName ? call(function () { return host.appName(id); }) : "") || "";
  }
  function ago(at, now) {
    var C = root.orosClip && root.orosClip.model;
    if (!C || typeof C.ago !== "function") return "";
    var a = C.ago(at, now);
    return t(a.k, { n: a.n });
  }

  // Files that are no longer on the disk: { at: true }, per open panel.
  var gone = {};
  function checkFiles(st) {
    if (!host || typeof host.stat !== "function") return;
    st.items.forEach(function (it) {
      if (it.k !== "files" || Object.prototype.hasOwnProperty.call(gone, it.at)) return;
      gone[it.at] = false;
      Promise.all(it.d.items.map(function (f) {
        return Promise.resolve(call(function () { return host.stat(f.path); })).then(function (s) { return !!s; }, function () { return false; });
      })).then(function (oks) {
        var miss = oks.some(function (ok) { return !ok; });
        if (miss !== gone[it.at]) { gone[it.at] = miss; if (dlg && dlg.open) paint(); }
      });
    });
  }

  function paint() {
    if (!dlg || !parts) return;
    var strict = strictOn(), st = strict ? { v: 1, items: [] } : load(), now = Date.now(), C = S();
    parts.list.textContent = "";
    parts.note.textContent = strict ? t("pk.strict") : st.items.length ? t("pk.hint") : t("pk.empty");
    parts.clear.hidden = !st.items.length;
    checkFiles(st);
    st.items.forEach(function (it) {
      var miss = gone[it.at] === true;
      var li = el("li", "pk-row" + (miss ? " pk-gone" : ""));
      li.setAttribute("data-at", String(it.at));
      var use = el("button", "pk-use");
      use.type = "button";
      var ic = el("span", "pk-ic");
      ic.innerHTML = IC[it.k] || IC.text;      // static shell icon, never data
      use.appendChild(ic);
      var tx = el("span", "pk-tx");
      var sum = C ? C.summary(it.k, it.d, lang()) : it.k;
      tx.appendChild(el("span", null, sum));
      var name = appName(it.app), when = ago(it.at, now);
      tx.appendChild(el("small", null, miss ? t("pk.missing") : [name, when].filter(Boolean).join(" · ")));
      use.appendChild(tx);
      use.setAttribute("aria-label", t("pk.send") + " " + sum);
      use.disabled = miss;
      use.addEventListener("click", function () { sendIt(it.at); });
      li.appendChild(use);
      if (it.k !== "files" && !miss) dragOut(li, it);   // W2: drag into a field of any app
      if (it.k !== "files") li.appendChild(iconBtn(IC.copy, t("pk.copy"), function () { copyIt(it.at); }));
      li.appendChild(iconBtn(IC.x, t("pk.remove"), function () {
        save(remove(load(), it.at));
        var n = parts && (parts.list.querySelector(".pk-use:not(:disabled)") || parts.x);
        if (n) n.focus();
      }));
      parts.list.appendChild(li);
    });
  }

  // W2: drag a row out into a field. The panel steps aside (closed,
  // still in the page, so the drag goes on) and is removed when the
  // drag ends. The marker type keeps the Pocket from taking it back.
  var dragging = false;
  function dragOut(li, it) {
    li.draggable = true;
    li.addEventListener("dragstart", function (e) {
      var dt = e.dataTransfer;
      if (!dt) return;
      var text = plain(it.k, it.d);
      try {
        dt.setData("text/plain", text);
        if (it.k === "link" && it.d && it.d.url) dt.setData("text/uri-list", it.d.url);
        dt.setData("application/x-oros-pocket", "1");
        dt.effectAllowed = "copy";
      } catch (x) {}
      dragging = true;
      lastFocus = null;
      var d = dlg;
      setTimeout(function () { if (d && d.open && dragging) { try { d.close(); } catch (x) { d.removeAttribute("open"); } } }, 0);
    });
    li.addEventListener("dragend", function () {
      if (!dragging) return;
      dragging = false;
      close();
    });
  }
  // W2: Ctrl+V on the open panel keeps what was copied.
  function pasted(e) {
    if (!dlg || !dlg.open || dragging) return;
    var tg = e.target;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    var cd = e.clipboardData, txt = "";
    try { txt = cd ? cd.getData("text/plain") || "" : ""; } catch (x) { txt = ""; }
    e.preventDefault();
    var s = txt.trim();
    if (!s) { toast("err", t("pk.noimport")); return; }
    if (/^https?:\/\/\S+$/i.test(s)) keep("link", { url: s }, "");
    else keep("text", { text: txt }, "");
  }

  function sendIt(at) {
    var it = find(load(), at);
    if (!it || !host || !host.send) return;
    lastFocus = null;          // the Send sheet takes the focus
    close();
    call(function () { host.send({ kind: it.k, data: it.d, app: it.app }); });
  }

  function copyIt(at) {
    var it = find(load(), at);
    if (!it) return;
    var text = plain(it.k, it.d);
    function done(ok) { toast(ok ? "ok" : "err", t(ok ? "pk.copied" : "pk.nocopy")); }
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
    if (root.orosClip && it.app) call(function () { root.orosClip.note(text, it.app); });   // clipboard history, when on
  }

  function open() {
    if (locked()) return;
    if (dlg && dlg.open) { paint(); return; }
    if (dlg) { dragging = false; close(); }       // a panel left aside by a drag
    lastFocus = doc.activeElement;
    gone = {};
    build();
    paint();
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    doc.addEventListener("paste", pasted);
    var first = dlg.querySelector(".pk-use:not(:disabled)");
    (first || parts.x).focus();
  }
  function close() {
    doc.removeEventListener("paste", pasted);
    if (!dlg) return;
    var d = dlg;
    if (d.open) { try { d.close(); } catch (e) { d.removeAttribute("open"); } }
    if (d.parentNode) d.parentNode.removeChild(d);
    dlg = null; parts = null;
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) call(function () { lastFocus.focus(); });
    lastFocus = null;
  }
  function clear() {
    save({ v: 1, items: [] });
    if (parts) parts.x.focus();
  }

  function attach(h) {
    host = h || {};
    injectCss();
  }

  root.__orosPocketImpl = {
    VER: VER,
    model: model,
    attach: attach,
    keep: keep,
    open: open,
    close: close,
    clear: clear,
    isOpen: function () { return !!(dlg && dlg.open); },
    refresh: function () { if (dlg && dlg.open) { close(); open(); } },   // a language change
    repaint: function () { if (dlg && dlg.open) paint(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
