// ============================================================
// orOS single apps (solo.js)
// ------------------------------------------------------------
// "orOS Notes", "orOS Calendar", ... : one orOS app installed on its
// own (own icon, name and window), offline first, with the same
// encrypted sync as orOS when the person turns it on.
//
// How it is built (Chris 2026-10-14, thread "Companion apps orOS"):
//   /<id>/solo.html   the installed page. Its own manifest
//                     (/<id>/manifest.webmanifest, scope /<id>/) gives
//                     the separate icon, name, shortcuts, file types
//                     and share target. The page holds nothing but a
//                     full-window frame (host(), below).
//   /?solo=<id>       inside that frame: the real orOS shell in solo
//                     mode. Same files, same sync engine, same app
//                     code as orOS: no second copy of any app, of the
//                     encryption or of the merges. The shell shows only
//                     that app (no desktop, menu or Dock); another app
//                     opened from it (Settings, a link) gets a Back.
// Same origin as orOS, so on a device that has both they share the
// data at once; on a device with only the single app the data stays
// local until the person connects the cloud in Settings › Sync.
//
// The window that is NOT the frame (the host) forwards what only a
// top-level page receives: launch parameters (shortcuts, Share, "Open
// with"), launchQueue files and the icon badge.
//
// Shared by the host page, the shell (window.orosSolo) and node tests.
// ============================================================
(function (root) {
  "use strict";

  // The apps that ship as single apps. Each needs /<id>/solo.html,
  // /<id>/manifest.webmanifest and icons/solo/<id>-*.png
  // (tests/solo.test.js keeps them in step with this table).
  //   shortcuts: long-press / right-click menu of the app icon. "do"
  //     is the word in the shortcut URL (/<id>/solo.html?do=<word>);
  //     target goes to the app through __orosOpenAt, calNew opens
  //     Calendar's New event on today.
  //   share: what a shared link or text becomes (shareTarget below).
  //   badge: what the icon badge counts (the shell's solo badge tick).
  var APPS = {
    notes: {
      name: { en: "orOS Notes", el: "orOS Σημειώσεις" },
      shortcuts: [{ do: "new", name: { en: "New page", el: "Νέα σελίδα" }, target: { newPage: true } }],
      share: "note"
    },
    calendar: {
      name: { en: "orOS Calendar", el: "orOS Ημερολόγιο" },
      shortcuts: [{ do: "new", name: { en: "New event", el: "Νέο συμβάν" }, calNew: true }],
      share: "event"
    },
    bookmarks: {
      name: { en: "orOS Bookmarks", el: "orOS Σελιδοδείκτες" },
      shortcuts: [{ do: "add", name: { en: "Add a bookmark", el: "Νέος σελιδοδείκτης" }, target: { quickAdd: true } }],
      share: "link"
    },
    todo: {
      name: { en: "orOS To-Do", el: "orOS Εργασίες" },
      shortcuts: [{ do: "new", name: { en: "New task", el: "Νέα εργασία" }, target: { quickAdd: true } }],
      share: "task",
      badge: "due"
    }
  };

  var ID_RE = /^[a-z0-9-]{1,40}$/;
  // Launch parameters the host hands to the shell frame unchanged
  // (each one is checked again where it is used).
  var FORWARD = ["do", "share-url", "share-title", "share-text", "share-files", "file-open"];
  var MAX_PARAM = 4000;

  function has(id) {
    return typeof id === "string" && ID_RE.test(id) && Object.prototype.hasOwnProperty.call(APPS, id);
  }
  function ids() { return Object.keys(APPS); }
  function lang(l) { return l === "el" ? "el" : "en"; }
  function nameOf(id, l) { return has(id) ? APPS[id].name[lang(l)] : ""; }

  // The installed page's path: "/notes/solo.html" → "notes".
  function idFromPath(pathname) {
    var m = /^\/([a-z0-9-]+)\/solo\.html$/.exec(String(pathname || ""));
    return m && has(m[1]) ? m[1] : "";
  }
  // The shell frame's address: "?solo=notes" → "notes".
  function idFromSearch(search) {
    var v = "";
    try { v = new URLSearchParams(String(search || "")).get("solo") || ""; } catch (e) { v = ""; }
    return has(v) ? v : "";
  }

  // Host → shell frame address. Only the FORWARD keys travel, each
  // bounded; "solo" itself stays in the frame's address so the update
  // broker's reload comes back in solo mode.
  function frameSrc(id, search) {
    if (!has(id)) return "";
    var q, out = new URLSearchParams();
    try { q = new URLSearchParams(String(search || "")); } catch (e) { q = new URLSearchParams(); }
    out.set("solo", id);
    FORWARD.forEach(function (k) {
      var v = q.get(k);
      if (typeof v === "string" && v) out.set(k === "do" ? "solo-do" : k, v.slice(0, MAX_PARAM));
    });
    return "/?" + out.toString();
  }

  // Shortcut word → what to open. null = just the app.
  function shortcut(id, word) {
    if (!has(id) || typeof word !== "string") return null;
    var list = APPS[id].shortcuts || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].do === word) return list[i];
    }
    return null;
  }

  function ymd(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function clean(v, max) {
    return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  }
  function httpUrl(v) {
    try {
      var u = new URL(String(v || "").trim());
      return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= 2048 ? u.href : "";
    } catch (e) { return ""; }
  }

  // Share params (?share-url / share-title / share-text, the shape
  // sw.js and the browser add-on use) → { url, title, text } or null.
  function shareFromSearch(search) {
    var q;
    try { q = new URLSearchParams(String(search || "")); } catch (e) { return null; }
    if (!q.has("share-url") && !q.has("share-title") && !q.has("share-text")) return null;
    var text = clean(q.get("share-text"), 20000);
    var url = httpUrl(q.get("share-url"));
    if (!url) {
      var m = text.match(/https?:\/\/[^\s<>"']+/i);
      if (m) url = httpUrl(m[0]);
    }
    var title = clean(q.get("share-title"), 256);
    if (!title && !url && !text) return null;
    return { url: url, title: title, text: text };
  }

  // A share → where it goes in this single app:
  //   { app, target }        through __orosOpenAt
  //   { calNew: payload }    Calendar's New event dialog
  //   null                   nothing usable (e.g. Bookmarks without a link)
  // Nothing is saved here: every app opens its own dialog or page.
  function shareTarget(id, s, now) {
    if (!has(id) || !s) return null;
    var kind = APPS[id].share;
    var url = s.url || "", title = s.title || "", text = s.text || "";
    var bodyText = text;
    if (url && bodyText.indexOf(url) === -1) bodyText = (bodyText ? bodyText + "\n\n" : "") + url;
    var firstLine = (title || text.replace(url, "").split(/\r?\n/)[0] || url).replace(/\s+/g, " ").trim();
    if (kind === "link") {
      if (!url) return null;
      return { app: id, target: { add: { url: url, title: (title || text.replace(url, "")).replace(/\s+/g, " ").trim().slice(0, 256) } } };
    }
    if (kind === "note") {
      return { app: id, target: { add: { title: firstLine.slice(0, 200), text: bodyText.slice(0, 20000) } } };
    }
    if (kind === "task") {
      if (!firstLine) return null;
      var note = bodyText.replace(firstLine, "").trim();
      return { app: id, target: { addItems: { items: [{ text: firstLine.slice(0, 500), note: note.slice(0, 2000) }] } } };
    }
    if (kind === "event") {
      if (!firstLine) return null;
      var date = ymd(now instanceof Date ? now : new Date());
      return { calNew: { date: date, title: firstLine.slice(0, 80), note: bodyText.replace(firstLine, "").trim().slice(0, 500) } };
    }
    return null;
  }

  // Per-app manifest (what tests/solo.test.js expects each
  // /<id>/manifest.webmanifest to hold). handlers = fileopen.js
  // table(); base = orOS's own manifest, for colours and categories.
  function manifestFor(id, handlers, base) {
    if (!has(id)) return null;
    var a = APPS[id], scope = "/" + id + "/", page = scope + "solo.html";
    var icon = "/icons/solo/" + id;
    var m = {
      name: a.name.en,
      short_name: a.name.en.replace(/^orOS /, ""),
      description: a.name.en + ": the orOS app on its own. Works offline, no cookies, no tracking; encrypted sync only if you turn it on.",
      id: page,
      start_url: page,
      scope: scope,
      display: "standalone",
      orientation: "any",
      background_color: (base && base.background_color) || "#14120d",
      theme_color: (base && base.theme_color) || "#1b1a18",
      icons: [
        { src: icon + ".svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: icon + "-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: icon + "-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: icon + "-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ],
      lang: "en",
      dir: "ltr",
      categories: (base && base.categories) || ["productivity"],
      shortcuts: (a.shortcuts || []).map(function (s) {
        return { name: s.name.en, short_name: s.name.en, url: page + "?do=" + s.do,
                 icons: [{ src: icon + "-192.png", sizes: "192x192", type: "image/png" }] };
      })
    };
    var accept = {}, exts = [];
    (handlers || []).forEach(function (h) {
      if (h.app !== id) return;
      Object.keys(h.accept).forEach(function (mime) {
        accept[mime] = h.accept[mime].slice();
        exts = exts.concat(mime, h.accept[mime]);
      });
    });
    if (Object.keys(accept).length) {
      m.file_handlers = [{ action: page + "?file-open=" + id, accept: accept }];
    }
    var share = {
      action: page + "?share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" }
    };
    if (exts.length) share.params.files = [{ name: "files", accept: exts }];
    m.share_target = share;
    return m;
  }

  // The installed page, /<id>/solo.html (base = orOS's manifest).
  function pageFor(id, base) {
    if (!has(id)) return "";
    var name = nameOf(id, "en");
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8">',
      "  <!-- The installed single app \"" + name + "\" (solo.js): its own manifest,",
      "       icon and window; the page frames the orOS shell in solo mode. -->",
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
      "  <title>" + name + "</title>",
      '  <link rel="manifest" href="manifest.webmanifest">',
      '  <meta name="theme-color" content="' + base.theme_color + '">',
      '  <link rel="icon" href="/icons/solo/' + id + '.svg" type="image/svg+xml">',
      '  <link rel="apple-touch-icon" href="/icons/solo/' + id + '-192.png">',
      '  <meta name="mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '  <meta name="apple-mobile-web-app-title" content="' + name + '">',
      "  <style>html,body{margin:0;height:100%;overflow:hidden;background:" + base.background_color + "}" +
        "#solo-frame{display:block;border:0;width:100%;height:100%}</style>",
      "</head>",
      "<body>",
      '  <script src="/solo.js"></script>',
      "  <script>window.orosSolo.hostBoot(window);</script>",
      "</body>",
      "</html>",
      ""
    ].join("\n");
  }

  // ---------- Host: the installed page (/<id>/solo.html) ----------
  function host(win) {
    var doc = win.document;
    var id = idFromPath(win.location.pathname);
    if (!id) { win.location.replace("/"); return; }
    var src = frameSrc(id, win.location.search);
    // The launch parameters are one-shots: out of the address bar, so
    // a reload of this window is a plain start.
    try { win.history.replaceState(null, "", win.location.pathname); } catch (e) {}

    var frame = doc.createElement("iframe");
    frame.id = "solo-frame";
    frame.title = nameOf(id, "en");
    frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; geolocation; camera; microphone; screen-wake-lock");
    frame.src = src;
    doc.body.appendChild(frame);
    frame.addEventListener("load", function () { try { frame.focus(); } catch (e) {} });

    // "Open with" (file_handlers): the browser hands the files to the
    // TOP page only. They wait until the shell in the frame has its
    // file module (fileopen.js queues them until the app list is in).
    var waiting = [];
    function handOver() {
      var fo = null;
      try { fo = frame.contentWindow && frame.contentWindow.orosFileOpen; } catch (e) { fo = null; }
      if (!fo || typeof fo.open !== "function") return false;
      fo.open(waiting.splice(0));
      return true;
    }
    function deliver(files) {
      waiting = waiting.concat(files);
      var tries = 0;
      (function again() {
        if (handOver() || ++tries > 150) return;   // 30 s, then give up quietly
        setTimeout(again, 200);
      })();
    }
    if (win.launchQueue && typeof win.launchQueue.setConsumer === "function") {
      win.launchQueue.setConsumer(function (params) {
        var hs = params && params.files ? Array.prototype.slice.call(params.files) : [];
        if (!hs.length) return;
        Promise.all(hs.map(function (h) {
          return h && typeof h.getFile === "function" ? h.getFile().then(null, function () { return null; }) : null;
        })).then(function (files) {
          files = files.filter(Boolean);
          if (files.length) deliver(files);
        });
      });
    }

    // What the shell in the frame asks of the top page.
    win.__orosSoloHost = {
      v: 1,
      id: id,
      title: function (t) {
        t = String(t || "").slice(0, 120);
        if (t) doc.title = t;
      },
      badge: function (n) {
        var nav = win.navigator;
        n = Math.max(0, Math.floor(Number(n) || 0));
        try {
          if (n > 0 && typeof nav.setAppBadge === "function") nav.setAppBadge(n).catch(function () {});
          else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge().catch(function () {});
        } catch (e) {}
      }
    };
  }

  // ---------- Shell side ----------
  // window.orosSolo in the shell: set before shell.js / fileopen.js
  // load, so both can ask "which single app am I?" at boot.
  var api = {
    v: 1,
    APPS: APPS,
    FORWARD: FORWARD,
    has: has,
    ids: ids,
    nameOf: nameOf,
    idFromPath: idFromPath,
    idFromSearch: idFromSearch,
    frameSrc: frameSrc,
    shortcut: shortcut,
    shareFromSearch: shareFromSearch,
    shareTarget: shareTarget,
    manifestFor: manifestFor,
    pageFor: pageFor,
    hostBoot: host,
    id: "",
    share: null,
    word: ""
  };

  if (root && root.document && root.location) {
    api.id = idFromSearch(root.location.search);
    if (api.id) {
      // Read before the shell strips its own launch parameters.
      api.share = shareFromSearch(root.location.search);
      try { api.word = new URLSearchParams(root.location.search).get("solo-do") || ""; } catch (e) { api.word = ""; }
      try {
        var u = new URL(root.location.href);
        u.searchParams.delete("solo-do");
        if (api.share) ["share-url", "share-title", "share-text"].forEach(function (k) { u.searchParams.delete(k); });
        root.history.replaceState(root.history.state, "", u.pathname + u.search + u.hash);
      } catch (e) {}
    }
    // The host page that framed us (same origin), if any.
    api.host = function () {
      try {
        var p = root.parent;
        return p && p !== root && p.__orosSoloHost && p.__orosSoloHost.id === api.id ? p.__orosSoloHost : null;
      } catch (e) { return null; }
    };
    root.orosSolo = api;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
