// ============================================================
// orOS — search.js (universal search core, v1.0.0)
// ------------------------------------------------------------
// The shell's search over every app's own data. Pure logic, no
// DOM: shell.js draws the results, this file finds and ranks them.
// Unit-tested in node (tests/search.test.js).
//
// Provider contract (see OROS_BIBLE.md "Universal search"):
//   • Each app that has user text ships <app>/search.js and declares
//     it in apps.json: "search": "search.js". The shell loads those
//     files on the FIRST search (never at boot), from the precache.
//   • The file pushes ONE object onto window.orosSearchProviders:
//       { id: "<app id>",
//         keys: ["oros-<app>-data"],          // what it reads
//         search: function (ctx) → [hit] | Promise<[hit]>,
//         open:   function (target, win)      // optional
//       }
//     hit = { id, title, text?, when?, target? }
//       title / text are PLAIN text (drawn with textContent only);
//       when   = ms timestamp (recency tie-break, shown as a date);
//       target = small JSON value handed back to the app on open.
//   • READ-ONLY: a provider never writes storage and never talks to
//     sync. It skips deleted / tombstoned / hidden items.
//   • ctx = { q, words, fold, lang, limit, readJSON(key) }. Matching
//     and ranking happen HERE, the same for every app; a provider may
//     pre-filter with ctx.words / ctx.fold, it does not have to.
//   • A provider that throws, or answers later than TIMEOUT_MS, is
//     skipped for that search; one app can never break the search.
//   • No index and no history are stored: the query lives in memory.
// ============================================================
(function (root) {
  "use strict";

  var MIN_CHARS   = 2;      // data search starts at 2 characters
  var PER_APP_MAX = 50;     // hits kept per provider
  var TIMEOUT_MS  = 1000;   // slower providers are skipped
  var SNIPPET_LEN = 90;
  var FILE_RE     = /^[a-z0-9][a-z0-9_-]{0,40}\.js$/;

  // ---------- 1. Folding (same rules as the A74 menu search) ----------
  // Case- and accent-insensitive; final ς = σ. foldMap() also keeps,
  // for every folded character, the index of the ORIGINAL character
  // it came from, so highlights land on the right letters even when a
  // character folds to zero or several characters.
  function foldChar(ch) {
    var s = ch.toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }
  function fold(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }
  function foldMap(s) {
    s = String(s == null ? "" : s);
    var out = "", map = [];
    for (var i = 0; i < s.length; ) {
      var cp = s.codePointAt(i);
      var len = cp > 0xffff ? 2 : 1;
      var f = foldChar(s.substr(i, len));
      for (var k = 0; k < f.length; k++) map.push(i);
      out += f;
      i += len;
    }
    map.push(s.length);
    return { text: out, map: map };
  }

  // Unique folded words, longest first (so "αθ" does not hide "αθηνα"
  // in the highlights).
  function parseQuery(q) {
    var seen = {}, words = [];
    fold(q).split(/\s+/).forEach(function (w) {
      if (w && !seen[w]) { seen[w] = true; words.push(w); }
    });
    words.sort(function (a, b) { return b.length - a.length; });
    return words;
  }

  function isWordStart(s, i) {
    if (i === 0) return true;
    return !/[0-9a-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/.test(s.charAt(i - 1));
  }

  // ---------- 2. Scoring ----------
  // Every word must appear in the title or the text. Per word:
  // title starts with it 40 · a title word starts with it 25 ·
  // inside the title 15 · only in the text 5. The whole query as one
  // phrase in the title adds 20. -1 = no match.
  function score(hit, words, phrase) {
    var t = fold(hit.title), x = null, total = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], p = t.indexOf(w);
      if (p === 0) total += 40;
      else if (p > 0) {
        var best = 15, from = p;
        while (from !== -1) {
          if (isWordStart(t, from)) { best = 25; break; }
          from = t.indexOf(w, from + 1);
        }
        total += best;
      } else {
        if (x === null) x = fold(hit.text);
        if (x.indexOf(w) === -1) return -1;
        total += 5;
      }
    }
    if (phrase && words.length > 1 && t.indexOf(phrase) !== -1) total += 20;
    return total;
  }

  // ---------- 3. Snippet + highlight ranges ----------
  function squash(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // A short excerpt of the text around the first matching word, or
  // its beginning when only the title matched.
  function snippet(text, words, max) {
    max = max || SNIPPET_LEN;
    var s = squash(text);
    if (!s) return "";
    if (s.length <= max) return s;
    var fm = foldMap(s), first = -1;
    for (var i = 0; i < words.length; i++) {
      var p = fm.text.indexOf(words[i]);
      if (p !== -1 && (first === -1 || p < first)) first = p;
    }
    var at = first === -1 ? 0 : fm.map[first];
    var start = Math.max(0, at - Math.floor(max / 3));
    if (start > 0) {
      var sp = s.indexOf(" ", start);
      if (sp !== -1 && sp < at) start = sp + 1;
    }
    var end = Math.min(s.length, start + max);
    if (end < s.length) {
      var sp2 = s.lastIndexOf(" ", end);
      if (sp2 > start + max / 2) end = sp2;
    }
    return (start > 0 ? "…" : "") + s.slice(start, end) + (end < s.length ? "…" : "");
  }

  // [[start, end], …] in the ORIGINAL string, merged and sorted.
  function ranges(str, words) {
    var fm = foldMap(str), out = [];
    words.forEach(function (w) {
      var from = 0, p;
      while (w && (p = fm.text.indexOf(w, from)) !== -1) {
        out.push([fm.map[p], fm.map[p + w.length]]);
        from = p + w.length;
      }
    });
    out.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var merged = [];
    out.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else if (r[1] > r[0]) merged.push([r[0], r[1]]);
    });
    return merged;
  }

  // ---------- 4. Reading app data (parse once per stored string) ----------
  function makeReader(storage) {
    var cache = {};
    return function readJSON(key) {
      var raw = null;
      try { raw = storage.getItem(key); } catch (e) { return null; }
      var c = cache[key];
      if (c && c.raw === raw) return c.val;
      var val = null;
      if (raw) { try { val = JSON.parse(raw); } catch (e) { val = null; } }
      cache[key] = { raw: raw, val: val };
      return val;
    };
  }

  // ---------- 5. Normalising what a provider returns ----------
  function cleanHit(h) {
    if (!h || typeof h !== "object") return null;
    var title = squash(h.title);
    if (!title) return null;
    var when = typeof h.when === "number" && isFinite(h.when) ? h.when : 0;
    return {
      id: String(h.id == null ? "" : h.id),
      title: title.slice(0, 200),
      text: typeof h.text === "string" ? h.text : "",
      when: when,
      target: h.target === undefined ? null : h.target
    };
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      Promise.resolve(p).then(function (v) {
        if (!done) { done = true; clearTimeout(timer); resolve(v); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      });
    });
  }

  // ---------- 6. One search over a list of providers ----------
  // opts: { lang, storage, readJSON, enabled(id) → bool, timeoutMs }
  // Resolves to [{ id, total, hits: [{…hit, score, snippet}] }] in
  // provider order; providers with no hit are left out.
  function run(providers, query, opts) {
    opts = opts || {};
    var words = parseQuery(query);
    var phrase = fold(query).replace(/\s+/g, " ").trim();
    if (!words.length || phrase.replace(/ /g, "").length < MIN_CHARS) {
      return Promise.resolve([]);
    }
    var readJSON = opts.readJSON || makeReader(opts.storage || root.localStorage);
    var ctx = {
      q: String(query), words: words.slice(), fold: fold,
      lang: opts.lang === "el" ? "el" : "en",
      limit: PER_APP_MAX, readJSON: readJSON
    };
    var list = (providers || []).filter(function (p) {
      return p && typeof p.id === "string" && typeof p.search === "function" &&
             (!opts.enabled || opts.enabled(p.id));
    });
    return Promise.all(list.map(function (p) {
      var out;
      try { out = p.search(ctx); } catch (e) { out = null; }
      return withTimeout(out, opts.timeoutMs || TIMEOUT_MS).then(function (arr) {
        if (!Array.isArray(arr)) return null;
        var hits = [];
        for (var i = 0; i < arr.length; i++) {
          var h = cleanHit(arr[i]);
          if (!h) continue;
          var s = score(h, words, phrase);
          if (s < 0) continue;
          h.score = s;
          hits.push(h);
        }
        if (!hits.length) return null;
        hits.sort(function (a, b) {
          return b.score - a.score || b.when - a.when ||
                 (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
        });
        var total = hits.length;
        hits = hits.slice(0, PER_APP_MAX);
        hits.forEach(function (h) { h.snippet = snippet(h.text, words); });
        return { id: p.id, total: total, hits: hits, best: hits[0].score };
      });
    })).then(function (groups) {
      return groups.filter(Boolean);
    });
  }

  // ---------- 7. Loading provider files (shell only) ----------
  // apps: the apps.json list. Each internal app with a valid
  // "search" file name gets ONE <script> tag, once per session.
  var loading = {};
  function load(apps, version, doc) {
    doc = doc || root.document;
    var waits = [];
    (apps || []).forEach(function (app) {
      if (!app || app.type !== "internal" || typeof app.search !== "string") return;
      if (!FILE_RE.test(app.search) || typeof app.url !== "string" ||
          !/^[a-z0-9_-]+\/$/.test(app.url)) return;
      var src = app.url + app.search + (version ? "?v=" + encodeURIComponent(version) : "");
      if (!loading[src]) {
        loading[src] = new Promise(function (resolve) {
          var s = doc.createElement("script");
          s.src = src;
          s.async = true;
          s.onload = s.onerror = function () { resolve(); };
          doc.head.appendChild(s);
        });
      }
      waits.push(loading[src]);
    });
    return Promise.all(waits);
  }

  var api = {
    MIN_CHARS: MIN_CHARS, PER_APP_MAX: PER_APP_MAX, TIMEOUT_MS: TIMEOUT_MS,
    fold: fold, foldMap: foldMap, parseQuery: parseQuery, score: score,
    snippet: snippet, ranges: ranges, makeReader: makeReader,
    cleanHit: cleanHit, run: run, load: load
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) {
    root.orosSearch = api;
    root.orosSearchProviders = root.orosSearchProviders || [];
  }
})(typeof window !== "undefined" ? window : globalThis);
