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
    { code: "de", name: "Deutsch",  locale: "de-DE", dir: "ltr", status: "partial" }
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
