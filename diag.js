// ============================================================
// orOS Core — error journal (diag.js, shell only)
// Settings › System › Report a problem reads it. i18n.js (loaded
// first by every page) catches script errors and unhandled promise
// rejections of the shell and every app frame and hands them here.
// The journal keeps the last JOURNAL_MAX in the device-local key
// "oros-diag-log": never synced, never sent anywhere; only the
// person's own report file reads it. Only the message, the file
// and line are kept; URL queries and fragments are cut, messages
// are shortened, and a repeating error raises a count.
// Versioning: orOS-wide version lives ONLY in shell.js.
// ============================================================
(function () {
  "use strict";
  if (window.orosDiag || window.top !== window) return;
  var KEY = "oros-diag-log", JOURNAL_MAX = 60, MSG_MAX = 240;

  // "https://useoros.online/notes/notes.js?v=1#x" → "/notes/notes.js"
  function cleanUrls(s) {
    return String(s).replace(/(?:https?|file|chrome-extension):\/\/[^\s/)'"]*(\/[^\s?#)'"]*)?(?:[?#][^\s)'":]*)?/g,
      function (m, p) { return p || "/"; });
  }
  function clean(s, max) {
    s = cleanUrls(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  var list = null, timer = 0;
  function load() {
    if (list) return list;
    list = [];
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(raw)) list = raw.slice(-JOURNAL_MAX);
    } catch (e) {}
    return list;
  }
  function save() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
    }, 1500);
  }

  function add(e) {
    if (!e || typeof e !== "object") return;
    var entry = {
      t: new Date().toISOString(),
      app: clean(e.app || "shell", 40),
      kind: e.kind === "promise" ? "promise" : "error",
      msg: clean(e.msg, MSG_MAX),
      at: clean(e.at || "", 120)
    };
    if (!entry.msg) return;
    var l = load(), last = l[l.length - 1];
    if (last && last.app === entry.app && last.msg === entry.msg && last.at === entry.at) {
      last.n = (last.n || 1) + 1;
      last.t = entry.t;
    } else {
      l.push(entry);
      if (l.length > JOURNAL_MAX) l.splice(0, l.length - JOURNAL_MAX);
    }
    save();
  }

  window.orosDiag = {
    add: add,
    list: function () { return load().map(function (x) { var c = {}; for (var k in x) c[k] = x[k]; return c; }); },
    clear: function () { list = []; try { localStorage.removeItem(KEY); } catch (e) {} },
    KEY: KEY,
    clean: clean
  };
  // What i18n.js caught before this file ran.
  var q = window.__orosDiagQ;
  window.__orosDiagQ = null;
  if (q && q.length) q.forEach(add);
})();
