// ============================================================
// orOS Core — Languages beyond English and Greek (i18n packs)
// English and Greek live inline in every app ({ en: {…}, el: {…} })
// and are untouched by this file. Any other language is a folder of
// packs, i18n/<code>/<app>.js, written by translators:
//   orosPack("de", "notes", { "tree.empty": "Noch keine Seiten" });
// A pack is data only: strings, nothing else (tests/i18n.test.js
// rejects anything that is not a plain JSON object of strings). A
// value is used only when it carries the same {placeholders} and the
// same HTML tags as the English one, so a translation can never add
// markup to an innerHTML. Every missing key falls back to English.
//
// Loading: an app's index.html loads this file FIRST, with its id:
//   <script src="../i18n.js" data-app="notes"></script>
// For a pack language, the pack script is written right after it,
// so it runs before the app's own scripts (app init stays
// synchronous). English and Greek load nothing extra. A missing pack
// (offline, not translated yet) simply means English.
// The service worker keeps packs in their own cache across releases
// (sw.js LANG_CACHE); the shell fetches the chosen language's files
// once per release (i18n/<code>/manifest.json, see
// .github/i18n/coverage.js).
// Versioning: orOS-wide version lives ONLY in shell.js.
// ============================================================

// i18n-inline-ok: language names in their own language (LANGS) are data
(function () {
  "use strict";
  if (window.orosI18n) return;

  // ---- Languages (data: edited by .github/i18n/new-language.js) ----
  // code: BCP 47 language code, also the folder name in i18n/.
  // name: the language's own name. locale: dates and numbers.
  // status: "full" (shown), "partial" (shown, marked partly
  // translated) or "hidden" (only ?lang=<code>, while the shell,
  // Settings and Help are not translated yet).
  var LANGS = [
    { code: "en", name: "English",  locale: "en-GB", dir: "ltr", status: "full" },
    { code: "el", name: "Ελληνικά", locale: "el-GR", dir: "ltr", status: "full" },
    { code: "de", name: "Deutsch",  locale: "de-DE", dir: "ltr", status: "full" }
  ];
  // ---- end of languages ----

  var INLINE = { en: true, el: true };
  var packs = {};          // packs[code][app] = { key: string }
  var CODE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
  var APP_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

  function info(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return null;
  }
  function known(code) { return typeof code === "string" && !!info(code); }

  // The active language: the shell's (window.orosLang, or the parent
  // frame's), then ?lang= on the top window, then the stored choice.
  function lang() {
    var c = null;
    try { if (known(window.orosLang)) c = window.orosLang; } catch (e) {}
    if (!c) try { if (window.parent !== window && known(window.parent.orosLang)) c = window.parent.orosLang; } catch (e) {}
    if (!c && window.top === window) {
      var m = /[?&]lang=([A-Za-z-]{2,6})(?:&|$)/.exec(location.search);
      if (m && known(m[1])) c = m[1];
    }
    if (!c) try { var s = localStorage.getItem("oros-lang"); if (known(s)) c = s; } catch (e) {}
    return c || "en";
  }

  // "el" or "en": for code that still picks between two inline
  // strings (lang === "el" ? … : …). A pack language reads English there.
  function base(code) { return (code || lang()) === "el" ? "el" : "en"; }

  function locale(code) { var i = info(code || lang()); return i ? i.locale : "en-GB"; }
  function dir(code) { var i = info(code || lang()); return i && i.dir === "rtl" ? "rtl" : "ltr"; }

  // Languages a picker offers: every shown one, plus the active one.
  function choices() {
    var cur = lang();
    return LANGS.filter(function (l) { return l.status !== "hidden" || l.code === cur; })
      .map(function (l) { return { code: l.code, name: l.name, partial: l.status !== "full" }; });
  }

  // ---- Pack checks (the same rules as tests/i18n.test.js) ----
  function placeholders(s) { return (String(s).match(/\{[A-Za-z0-9_.]+\}/g) || []).sort().join("|"); }
  function tags(s) { return (String(s).match(/<\/?[A-Za-z][^>]*>/g) || []).sort().join("|"); }
  function fits(en, v) {
    return typeof v === "string" && v.trim() !== "" && typeof en === "string" &&
      placeholders(en) === placeholders(v) && tags(en) === tags(v);
  }

  function orosPack(code, app, table) {
    if (!CODE_RE.test(code) || INLINE[code] || !APP_RE.test(app)) return;
    if (!table || typeof table !== "object" || Array.isArray(table)) return;
    var clean = {};
    Object.keys(table).forEach(function (k) {
      if (typeof table[k] === "string") clean[k] = table[k];
    });
    packs[code] = packs[code] || {};
    packs[code][app] = clean;
  }

  // A translator's own lines (Settings › Help translate), kept on this
  // device only: { <code>: { <app>: { key: text } } }. They go over the
  // pack's, through the same checks.
  var LOCAL_KEY = "oros-i18n-local";
  function local(code, app) {
    try {
      var all = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
      var t = all && all[code] && all[code][app];
      return t && typeof t === "object" && !Array.isArray(t) ? t : null;
    } catch (e) { return null; }
  }
  function packOf(code, app) {
    var out = {}, f = (packs[code] && packs[code][app]) || {}, l = local(code, app) || {};
    Object.keys(f).forEach(function (k) { out[k] = f[k]; });
    Object.keys(l).forEach(function (k) { if (typeof l[k] === "string") out[k] = l[k]; });
    return out;
  }

  // tables = an app's { en: {…}, el: {…} }. For a pack language, adds
  // tables[code] = English overlaid with the pack's fitting values, so
  // the app's usual lookup (STRINGS[LANG][key] || STRINGS.en[key])
  // works unchanged. Returns the table for the language.
  function table(tables, app, code) {
    code = code || lang();
    if (!tables || !tables.en) return {};
    if (INLINE[code]) return tables[code] || tables.en;
    var en = tables.en, p = packOf(code, app);
    var out = {};
    Object.keys(en).forEach(function (k) { out[k] = fits(en[k], p[k]) ? p[k] : en[k]; });
    tables[code] = out;
    return out;
  }

  // How much of an app's English table a pack covers, 0..1.
  function coverage(tables, app, code) {
    if (!tables || !tables.en) return 0;
    if (INLINE[code]) return 1;
    var en = tables.en, p = packOf(code, app);
    var keys = Object.keys(en), n = 0;
    keys.forEach(function (k) { if (fits(en[k], p[k])) n++; });
    return keys.length ? n / keys.length : 1;
  }

  // Plural forms: key + ".one" / ".few" / ".many" / ".other" (Intl
  // rules of the language), else the table's own ".one" / ".some".
  function plural(tbl, key, n, code) {
    var form = "other";
    try { form = new Intl.PluralRules(locale(code)).select(n); } catch (e) {}
    var v = tbl[key + "." + form];
    if (v === undefined) v = tbl[key + "." + (n === 1 ? "one" : "some")];
    if (v === undefined) v = tbl[key + ".other"];
    return v === undefined ? key : v;
  }

  // Where this file lives, so packs resolve from any app folder.
  var me = document.currentScript;
  var root = me && me.src ? me.src.replace(/i18n\.js(\?.*)?$/, "") : "./";
  var ver = me && me.src ? (/[?&]v=([^&]+)/.exec(me.src) || [])[1] : "";

  function packUrl(code, app) {
    return root + "i18n/" + code + "/" + app + ".js" + (ver ? "?v=" + ver : "");
  }

  // Help page: a pack language reads i18n/<code>/help/…; Help falls
  // back to English when the page is not translated yet.
  function helpPath(kind, id, code) {
    code = code || lang();
    if (INLINE[code]) return null;
    return "i18n/" + code + "/help/" + (kind === "t" ? "topics/" : "") + id + ".txt";
  }

  // Load a pack after start-up (the shell, on a language change).
  function ensure(code, app, done) {
    if (INLINE[code] || !known(code) || (packs[code] && packs[code][app])) { done(); return; }
    var s = document.createElement("script");
    s.src = packUrl(code, app);
    s.onload = s.onerror = function () { done(); };
    document.head.appendChild(s);
  }

  window.orosPack = orosPack;
  window.orosI18n = {
    LANGS: LANGS, known: known, info: info, lang: lang, base: base, locale: locale, dir: dir,
    choices: choices, table: table, coverage: coverage, plural: plural, fits: fits,
    helpPath: helpPath, ensure: ensure, packUrl: packUrl, root: root, ver: ver, LOCAL_KEY: LOCAL_KEY
  };

  // Start-up: write the pack(s) named in data-app before the app's scripts.
  var cur = lang();
  var apps = me && me.getAttribute("data-app");
  if (apps && !INLINE[cur] && document.readyState === "loading") {
    apps.split(",").forEach(function (a) {
      a = a.trim();
      if (APP_RE.test(a)) document.write('<script src="' + packUrl(cur, a) + '"><\/script>');
    });
  }
})();

// ---- Error journal (Settings › System › Report a problem) ----
// Lives here because i18n.js is the one file every orOS page loads
// first (the shell and every app frame). The top window keeps the
// last JOURNAL_MAX script errors and unhandled promise rejections in
// the device-local key "oros-diag-log" (never synced, never sent
// anywhere: only the person's own "Report a problem" file reads it).
// App frames hand their errors to the top window. Only the message,
// the file and line are kept; URL queries and fragments are cut,
// messages are shortened. A repeating error raises a count instead of
// filling the journal.
(function () {
  "use strict";
  if (window.orosDiag || typeof window.addEventListener !== "function") return;
  var KEY = "oros-diag-log", JOURNAL_MAX = 60, MSG_MAX = 240;
  var me = document.currentScript;
  var appId = ((me && me.getAttribute && me.getAttribute("data-app")) || "").split(",")[0].trim() || "page";

  // "https://useoros.online/notes/notes.js?v=1#x" → "/notes/notes.js"
  function cleanUrls(s) {
    return String(s).replace(/(?:https?|file|chrome-extension):\/\/[^\s/)'"]*(\/[^\s?#)'"]*)?(?:[?#][^\s)'":]*)?/g,
      function (m, p) { return p || "/"; });
  }
  function clean(s, max) {
    s = cleanUrls(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function top() {
    try { if (window.top !== window && window.top.orosDiag) return window.top.orosDiag; } catch (e) {}
    return null;
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
      app: clean(e.app || appId, 40),
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

  function report(e) {
    e.app = appId;
    var T = top();
    if (T) { try { T.add(e); return; } catch (x) {} }
    if (window.top === window) add(e);
  }

  window.addEventListener("error", function (ev) {
    // Resource load failures (no message) are left to their own code.
    if (!ev || !ev.message) return;
    var at = ev.filename ? ev.filename + ":" + (ev.lineno || 0) + ":" + (ev.colno || 0) : "";
    report({ kind: "error", msg: ev.message, at: at });
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason, msg;
    if (r && typeof r === "object") msg = (r.name ? r.name + ": " : "") + (r.message || "");
    else msg = String(r);
    if (msg === "Error: " || msg === "") msg = "(no message)";
    report({ kind: "promise", msg: msg, at: "" });
  });

  if (window.top === window) {
    window.orosDiag = {
      add: add,
      list: function () { return load().map(function (x) { var c = {}; for (var k in x) c[k] = x[k]; return c; }); },
      clear: function () { list = []; try { localStorage.removeItem(KEY); } catch (e) {} },
      KEY: KEY,
      clean: clean
    };
  }
})();
