// ============================================================
// orOS Help — App logic (v1.0.0)
// The orOS guide: general topics + one page per app, EN/EL,
// offline, searchable.
//   - pages are plain-text files in a strict Markdown subset
//     (see "Page format" in OROS_BIBLE.md): help/topics/<id>.<lang>.txt
//     and <appId>/help.<lang>.txt next to each app
//   - nothing in a page is ever treated as HTML: the renderer builds
//     DOM nodes with textContent; links only to apps, help pages
//     and https
//   - routes live in the hash: #t/<topic>, #a/<appId>, optional
//     /<section> — the shell's "?" button opens #a/<running app>
//   - accent-insensitive search over every page in the current
//     language (index built once, in the background)
// Data:
//   - none synced, nothing stored: Help keeps no state (R36)
// Sections:
//   1. Constants, i18n, helpers
//   2. Page parser (pure)
//   3. Search (pure)
//   4. Loading: topics, apps, pages
//   5. Rendering
//   6. Navigation + layout
//   7. Keyboard (Contract Β)
//   8. Palette
//   9. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var TOPICS_URL = "topics.json";
  var APPS_URL   = "../apps.json";
  var HOME_TOPIC = "start";
  var NARROW     = 720;             // px: list | page instead of side by side
  var MAX_HITS   = 30;
  var ID_RE      = /^[a-z0-9][a-z0-9-]{0,40}$/;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "title": "Help", "search": "Search the guide…", "back": "Back",
      "nav.guide": "Guide", "nav.apps": "Apps",
      "open.app": "Open {app}", "toc": "On this page",
      "missing.title": "No guide yet",
      "missing.body": "This app has no guide page yet. It is on the way.",
      "fallback.en": "This page is not in Greek yet; showing the English one.",
      "load.fail": "This page could not be loaded. If you are offline, open Help once while online.",
      "hits.none": "Nothing found for “{q}”.",
      "hits.count": "{n} results", "hits.one": "1 result",
      "soon": "soon"
    },
    el: {
      "title": "Βοήθεια", "search": "Αναζήτηση στον οδηγό…", "back": "Πίσω",
      "nav.guide": "Οδηγός", "nav.apps": "Εφαρμογές",
      "open.app": "Άνοιγμα: {app}", "toc": "Σε αυτή τη σελίδα",
      "missing.title": "Δεν υπάρχει οδηγός ακόμα",
      "missing.body": "Αυτή η εφαρμογή δεν έχει ακόμα σελίδα στον οδηγό. Έρχεται σύντομα.",
      "fallback.en": "Η σελίδα δεν υπάρχει ακόμα στα ελληνικά· βλέπεις την αγγλική.",
      "load.fail": "Η σελίδα δεν φορτώθηκε. Αν είσαι εκτός σύνδεσης, άνοιξε μία φορά τη Βοήθεια όσο είσαι online.",
      "hits.none": "Δεν βρέθηκε τίποτα για «{q}».",
      "hits.count": "{n} αποτελέσματα", "hits.one": "1 αποτέλεσμα",
      "soon": "σύντομα"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  // The shell's own strings (app names, category labels), when it is there.
  function shellT(key, fallback) {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.t === "function") {
        var v = p.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) {}
    return fallback;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // BOOT MARKER (the release stamp also versions page fetches, so an
  // update never shows a page cached by the previous release)
  var VER = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    VER = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("help.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Page parser (pure) ----------
  // Lower case, no accents, final sigma folded: «Συγχρονισμός» and
  // "συγχρονισμος" compare equal.
  function fold(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD");
    return s.replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
  }

  function slugify(s) {
    return fold(s).replace(/[^a-z0-9α-ω]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  // Link targets a page may use. Anything else is shown as plain text.
  //   app:<id>                 open that app
  //   help:a/<id>[#section]    that app's page
  //   help:t/<id>[#section]    a topic
  //   https://…                new tab
  function parseTarget(href) {
    href = String(href || "").trim();
    var m;
    if ((m = /^app:([a-z0-9-]+)$/.exec(href)) && ID_RE.test(m[1])) {
      return { kind: "app", id: m[1] };
    }
    if ((m = /^help:([at])\/([a-z0-9-]+)(?:#([a-z0-9α-ω-]+))?$/.exec(href)) && ID_RE.test(m[2])) {
      return { kind: "help", route: m[1] + "/" + m[2] + (m[3] ? "/" + m[3] : "") };
    }
    if (/^https:\/\/[^\s"'<>\\]+$/.test(href)) return { kind: "url", href: href };
    return null;
  }

  // One line of text → tokens: text, b, code, kbd (keys[]), link.
  var INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;
  function parseInline(s) {
    var out = [], last = 0, m;
    s = String(s || "");
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(s))) {
      if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
      else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
      else if (m[3] !== undefined) {
        out.push({ t: "kbd", keys: m[3].split("+").map(function (k) { return k.trim(); })
          .filter(function (k) { return k; }) });
      } else {
        var target = parseTarget(m[5]);
        out.push(target ? { t: "link", v: m[4], target: target } : { t: "text", v: m[4] });
      }
      last = INLINE_RE.lastIndex;
    }
    if (last < s.length) out.push({ t: "text", v: s.slice(last) });
    return out;
  }

  // Plain text of a line, markup removed (search, snippets).
  function inlineText(s) {
    return parseInline(s).map(function (tk) {
      return tk.t === "kbd" ? tk.keys.join("+") : tk.v;
    }).join("");
  }

  // A page → { title, blocks }. Blocks: h2/h3 {text, id}, p {text},
  // ul/ol {items[]}, tip/warn {text}. Unknown syntax is plain text.
  function parsePage(src) {
    var lines = String(src || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
    var page = { title: "", blocks: [] };
    var cur = null, used = {};
    function close() { cur = null; }
    function uniq(base) {
      var id = base || "s", n = 2;
      while (used[id]) id = base + "-" + (n++);
      used[id] = 1;
      return id;
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, ""), m;
      if (!line.trim()) { close(); return; }
      if ((m = /^#\s+(.+)$/.exec(line))) {
        close();
        if (!page.title) page.title = m[1].trim();
        else page.blocks.push({ t: "p", text: m[1].trim() });
        return;
      }
      if ((m = /^(##|###)\s+(.+)$/.exec(line))) {
        close();
        var text = m[2].trim();
        page.blocks.push({ t: m[1] === "##" ? "h2" : "h3", text: text, id: uniq(slugify(inlineText(text))) });
        return;
      }
      if ((m = /^>(!?)\s?(.*)$/.exec(line))) {
        var kind = m[1] ? "warn" : "tip";
        if (cur && cur.t === kind) cur.text += " " + m[2].trim();
        else { cur = { t: kind, text: m[2].trim() }; page.blocks.push(cur); }
        return;
      }
      if ((m = /^-\s+(.+)$/.exec(line)) || (m = /^\d{1,3}\.\s+(.+)$/.exec(line))) {
        var lt = /^-/.test(line) ? "ul" : "ol";
        if (!cur || cur.t !== lt) { cur = { t: lt, items: [] }; page.blocks.push(cur); }
        cur.items.push(m[1].trim());
        return;
      }
      if (cur && (cur.t === "ul" || cur.t === "ol") && /^\s{2,}\S/.test(line)) {
        cur.items[cur.items.length - 1] += " " + line.trim();
        return;
      }
      if (cur && (cur.t === "p" || cur.t === "tip" || cur.t === "warn")) {
        cur.text += " " + line.trim();
        return;
      }
      cur = { t: "p", text: line.trim() };
      page.blocks.push(cur);
    });
    return page;
  }

  // ---------- 3. Search (pure) ----------
  // A page → index entry: one row per section (the part before the
  // first heading belongs to the title).
  function indexPage(route, page) {
    var secs = [{ id: "", heading: page.title, text: "" }];
    page.blocks.forEach(function (b) {
      if (b.t === "h2" || b.t === "h3") {
        secs.push({ id: b.id, heading: inlineText(b.text), text: "" });
        return;
      }
      var s = secs[secs.length - 1];
      var txt = b.items ? b.items.map(inlineText).join(" ") : inlineText(b.text);
      s.text += (s.text ? " " : "") + txt;
    });
    return {
      route: route,
      title: page.title,
      ftitle: fold(page.title),
      secs: secs.map(function (s) {
        return { id: s.id, heading: s.heading, text: s.text, fh: fold(s.heading), ft: fold(s.text) };
      })
    };
  }

  // Every term must appear somewhere in the page. Score: title 12,
  // heading 5, text 1 per term; the best section is the hit.
  function search(index, query) {
    var terms = fold(query).split(/\s+/).filter(function (x) { return x.length > 1 || /\d/.test(x); });
    if (!terms.length) return [];
    var hits = [];
    index.forEach(function (doc) {
      var all = doc.ftitle + " " + doc.secs.map(function (s) { return s.fh + " " + s.ft; }).join(" ");
      if (!terms.every(function (q) { return all.indexOf(q) >= 0; })) return;
      var best = null, bestScore = -1, total = 0;
      doc.secs.forEach(function (s) {
        var sc = 0;
        terms.forEach(function (q) {
          if (doc.ftitle.indexOf(q) >= 0) sc += 12;
          if (s.fh.indexOf(q) >= 0) sc += 5;
          if (s.ft.indexOf(q) >= 0) sc += 1;
        });
        total += sc;
        if (sc > bestScore) { bestScore = sc; best = s; }
      });
      hits.push({ route: doc.route, title: doc.title, sec: best, score: bestScore * 10 + Math.min(total, 9) });
    });
    hits.sort(function (a, b) { return b.score - a.score || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0); });
    return hits.slice(0, MAX_HITS);
  }

  // A short piece of text around the first term (fold keeps length
  // for Greek and Latin, so positions map back to the original).
  function snippet(text, query, len) {
    len = len || 140;
    var f = fold(text), terms = fold(query).split(/\s+/).filter(Boolean), at = -1;
    for (var i = 0; i < terms.length && at < 0; i++) at = f.indexOf(terms[i]);
    if (text.length <= len) return text;
    var start = Math.max(0, (at < 0 ? 0 : at) - 40);
    var s = text.slice(start, start + len);
    return (start > 0 ? "…" : "") + s + (start + len < text.length ? "…" : "");
  }

  // ---------- 4. Loading: topics, apps, pages ----------
  var topics = [];          // [{ id }]
  var apps = [];            // apps.json entries (internal only)
  var pageCache = {};       // "t/sync" → { page, lang } | { missing: true }

  function stamped(url) {
    return VER ? url + "?v=" + encodeURIComponent(VER) : url;
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function getText(url) {
    return fetch(stamped(url)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function pageUrl(kind, id, lang) {
    return kind === "t" ? "topics/" + id + "." + lang + ".txt" : "../" + id + "/help." + lang + ".txt";
  }

  // The page in the current language, else English (flagged).
  function loadPage(kind, id) {
    var key = kind + "/" + id;
    if (pageCache[key]) return Promise.resolve(pageCache[key]);
    if (!ID_RE.test(id)) return Promise.resolve({ missing: true });
    function done(v) { pageCache[key] = v; return v; }
    return getText(pageUrl(kind, id, LANG))
      .then(function (txt) { return done({ page: parsePage(txt), lang: LANG }); })
      .catch(function () {
        if (LANG === "en") return done({ missing: true });
        return getText(pageUrl(kind, id, "en"))
          .then(function (txt) { return done({ page: parsePage(txt), lang: "en" }); })
          .catch(function () { return done({ missing: true }); });
      });
  }

  function appName(app) {
    return shellT("app." + app.id, app.name || app.id);
  }

  function catLabel(cat) {
    var c = String(cat || "").toLowerCase();
    return shellT("category." + c, cat || "");
  }

  // Apps grouped like the shell menu: by translated category label,
  // file order inside a category.
  function appGroups() {
    var groups = {}, order = [];
    apps.forEach(function (a) {
      var k = String(a.category || "").toLowerCase();
      if (!groups[k]) { groups[k] = { label: catLabel(a.category), apps: [] }; order.push(k); }
      groups[k].apps.push(a);
    });
    return order.map(function (k) { return groups[k]; }).sort(function (a, b) {
      return a.label.localeCompare(b.label, LANG === "el" ? "el" : "en");
    });
  }

  var index = null, indexing = null;
  function buildIndex() {
    if (indexing) return indexing;
    var jobs = topics.map(function (tp) { return ["t", tp.id]; })
      .concat(apps.map(function (a) { return ["a", a.id]; }));
    indexing = Promise.all(jobs.map(function (j) {
      return loadPage(j[0], j[1]).then(function (res) {
        return res.missing ? null : indexPage(j[0] + "/" + j[1], res.page);
      });
    })).then(function (docs) {
      index = docs.filter(Boolean);
      markMissing();
      return index;
    });
    return indexing;
  }

  // ---------- 5. Rendering ----------
  function renderInline(parent, s) {
    parseInline(s).forEach(function (tk) {
      if (tk.t === "text") parent.appendChild(document.createTextNode(tk.v));
      else if (tk.t === "b") parent.appendChild(el("strong", null, tk.v));
      else if (tk.t === "code") parent.appendChild(el("code", null, tk.v));
      else if (tk.t === "kbd") {
        var span = el("span", "keys");
        tk.keys.forEach(function (k, i) {
          if (i) span.appendChild(document.createTextNode("+"));
          span.appendChild(el("kbd", null, k));
        });
        parent.appendChild(span);
      } else if (tk.t === "link") {
        parent.appendChild(linkNode(tk.v, tk.target));
      }
    });
  }

  function linkNode(text, target) {
    var a = el("a", null, text);
    if (target.kind === "url") {
      a.href = target.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    }
    if (target.kind === "help") {
      a.href = "#" + target.route;
      a.addEventListener("click", function (e) { e.preventDefault(); go(target.route); });
      return a;
    }
    a.href = "#";
    a.className = "app-link";
    a.addEventListener("click", function (e) { e.preventDefault(); openApp(target.id); });
    return a;
  }

  function renderBlocks(box, page) {
    page.blocks.forEach(function (b) {
      var n;
      if (b.t === "h2" || b.t === "h3") {
        n = el(b.t);
        n.id = "s-" + b.id;
        renderInline(n, b.text);
      } else if (b.t === "ul" || b.t === "ol") {
        n = el(b.t);
        b.items.forEach(function (it) { var li = el("li"); renderInline(li, it); n.appendChild(li); });
      } else if (b.t === "tip" || b.t === "warn") {
        n = el("div", "note " + b.t);
        n.setAttribute("role", "note");
        renderInline(n, b.text);
      } else {
        n = el("p");
        renderInline(n, b.text);
      }
      box.appendChild(n);
    });
  }

  function renderToc(box, page) {
    var heads = page.blocks.filter(function (b) { return b.t === "h2"; });
    if (heads.length < 3) return;
    // Collapsed on a phone, so the page text starts on the first screen.
    var nav = el("details", "toc");
    nav.open = !narrow();
    nav.appendChild(el("summary", "toc-title", t("toc")));
    heads.forEach(function (h) {
      var a = el("a", null, inlineText(h.text));
      a.href = "#";
      a.addEventListener("click", function (e) { e.preventDefault(); scrollToSection(h.id); });
      nav.appendChild(a);
    });
    box.appendChild(nav);
  }

  function findApp(id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
    return null;
  }

  var renderSeq = 0;
  function showRoute(route) {
    var r = parseRoute(route);
    var box = $("page");
    var seq = ++renderSeq;
    markActive(r.kind + "/" + r.id);
    return loadPage(r.kind, r.id).then(function (res) {
      if (seq !== renderSeq) return;
      box.textContent = "";
      var app = r.kind === "a" ? findApp(r.id) : null;
      var head = el("div", "page-head");
      if (res.missing) {
        var known = r.kind === "a" ? app : topicKnown(r.id);
        head.appendChild(el("h1", null, app ? appName(app) : (known ? r.id : t("missing.title"))));
        box.appendChild(head);
        box.appendChild(el("p", "dim", known ? (r.kind === "a" ? t("missing.body") : t("load.fail")) : t("load.fail")));
        if (app) box.appendChild(openAppButton(app));
      } else {
        head.appendChild(el("h1", null, res.page.title));
        if (app) head.appendChild(openAppButton(app));
        box.appendChild(head);
        if (res.lang !== LANG) box.appendChild(el("div", "note tip", t("fallback.en")));
        renderToc(box, res.page);
        renderBlocks(box, res.page);
      }
      setView("page");
      document.title = (res.page ? res.page.title : t("title")) + " · " + t("title");
      if (r.sec) scrollToSection(r.sec);
      else $("page-scroll").scrollTop = 0;
    });
  }

  function openAppButton(app) {
    var b = el("button", "open-btn", t("open.app", { app: appName(app) }));
    b.type = "button";
    b.addEventListener("click", function () { openApp(app.id); });
    return b;
  }

  function scrollToSection(id) {
    var n = document.getElementById("s-" + id);
    if (!n) return;
    n.scrollIntoView({ block: "start" });
    n.classList.add("flash");
    setTimeout(function () { n.classList.remove("flash"); }, 1200);
  }

  function topicKnown(id) {
    return topics.some(function (tp) { return tp.id === id; });
  }

  // Sidebar: topics, then apps by category.
  function renderNav() {
    var nav = $("nav-list");
    nav.textContent = "";
    var g = el("section", "nav-group");
    g.appendChild(el("h2", null, t("nav.guide")));
    topics.forEach(function (tp) {
      g.appendChild(navItem("t/" + tp.id, tp.title || tp.id));
    });
    nav.appendChild(g);
    appGroups().forEach(function (grp) {
      var s = el("section", "nav-group");
      s.appendChild(el("h2", null, grp.label));
      grp.apps.forEach(function (a) { s.appendChild(navItem("a/" + a.id, appName(a))); });
      nav.appendChild(s);
    });
  }

  function navItem(route, label) {
    var a = el("a", "nav-item");
    a.href = "#" + route;
    a.setAttribute("data-route", route);
    a.appendChild(el("span", "nav-label", label));
    a.addEventListener("click", function (e) { e.preventDefault(); clearSearch(); go(route); });
    return a;
  }

  function markActive(route) {
    [].forEach.call(document.querySelectorAll(".nav-item"), function (n) {
      var on = n.getAttribute("data-route") === route;
      n.classList.toggle("active", on);
      if (on) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current");
    });
  }

  // After the index is built: apps without a page get a "soon" tag.
  function markMissing() {
    [].forEach.call(document.querySelectorAll(".nav-item"), function (n) {
      var r = n.getAttribute("data-route");
      var c = pageCache[r];
      var miss = !!(c && c.missing);
      n.classList.toggle("missing", miss);
      var tag = n.querySelector(".nav-soon");
      if (miss && !tag) n.appendChild(el("span", "nav-soon", t("soon")));
      if (!miss && tag) n.removeChild(tag);
    });
  }

  // Topic titles come from the pages themselves (first # line).
  function fillTopicTitles() {
    return Promise.all(topics.map(function (tp) {
      return loadPage("t", tp.id).then(function (res) {
        tp.title = res.missing ? tp.id : res.page.title;
      });
    }));
  }

  // Search results replace the page.
  function renderHits(q) {
    var box = $("page"), seq = ++renderSeq;
    buildIndex().then(function () {
      if (seq !== renderSeq) return;
      var hits = search(index, q);
      box.textContent = "";
      markActive("");
      var head = el("div", "page-head");
      head.appendChild(el("h1", null, q));
      box.appendChild(head);
      if (!hits.length) {
        box.appendChild(el("p", "dim", t("hits.none", { q: q })));
      } else {
        box.appendChild(el("p", "dim", hits.length === 1 ? t("hits.one") : t("hits.count", { n: hits.length })));
        var ul = el("ul", "hits");
        hits.forEach(function (h) {
          var li = el("li"), a = el("a", "hit");
          var route = h.route + (h.sec && h.sec.id ? "/" + h.sec.id : "");
          a.href = "#" + route;
          a.appendChild(el("span", "hit-title", h.title + (h.sec && h.sec.id ? " › " + h.sec.heading : "")));
          var body = h.sec ? (h.sec.text || "") : "";
          if (body) a.appendChild(el("span", "hit-text", snippet(body, q)));
          a.addEventListener("click", function (e) { e.preventDefault(); clearSearch(); go(route); });
          li.appendChild(a);
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }
      setView("page");
      $("page-scroll").scrollTop = 0;
    });
  }

  // ---------- 6. Navigation + layout ----------
  function parseRoute(route) {
    var m = /^([at])\/([a-z0-9-]+)(?:\/([a-z0-9α-ω-]+))?$/.exec(String(route || ""));
    if (!m) return { kind: "t", id: HOME_TOPIC, sec: "" };
    return { kind: m[1], id: m[2], sec: m[3] || "" };
  }

  function currentRoute() {
    var h = "";
    try { h = decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) {}
    return h;
  }

  // Hash changes never add history entries: the frame shares the
  // shell's history, and Back must leave the app, not walk pages.
  function go(route) {
    if (currentRoute() === route) { onHash(); return; }
    try { location.replace("#" + route); } catch (e) { onHash(); }
  }

  function onHash() {
    var r = currentRoute();
    if (!r && narrow()) { setView("list"); markActive(""); return; }
    showRoute(r);
  }

  function narrow() { return window.innerWidth < NARROW; }

  function setView(v) {
    document.body.setAttribute("data-view", v);
    $("back-btn").hidden = !(narrow() && v === "page");
  }

  function openApp(id) {
    try {
      var p = window.parent;
      if (p && p !== window && p.orosHelp && typeof p.orosHelp.openApp === "function") {
        p.orosHelp.openApp(id);
        return;
      }
    } catch (e) {}
    if (ID_RE.test(id)) location.href = "../" + id + "/";
  }

  var searchTimer = 0;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var q = $("search").value.trim();
      if (q) renderHits(q);
      else onHash();
    }, 120);
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    $("search").value = "";
  }

  // ---------- 7. Keyboard (Contract Β) ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // "/" jumps to the search box; Esc clears it
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        $("search").focus();
      } else if (e.key === "Escape" && e.target === $("search") && $("search").value) {
        e.preventDefault();
        clearSearch();
        onHash();
      }
    });
  }

  // ---------- 8. Palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 9. Wiring & boot ----------
  function applyI18n() {
    var name = shellT("app.help", t("title"));
    $("title").textContent = name;
    document.title = name + " · orOS";
    $("search").placeholder = t("search");
    $("search").setAttribute("aria-label", t("search"));
    $("back-btn").setAttribute("aria-label", t("back"));
    $("back-btn").title = t("back");
    $("nav-list").setAttribute("aria-label", t("nav.guide"));
  }

  function wire() {
    $("search").addEventListener("input", onSearchInput);
    $("search").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); var q = $("search").value.trim(); if (q) renderHits(q); }
    });
    $("back-btn").addEventListener("click", function () {
      clearSearch();
      go("");
      setView("list");
      markActive("");
    });
    window.addEventListener("hashchange", function () { clearSearch(); onHash(); });
    var wasNarrow = narrow();
    window.addEventListener("resize", function () {
      if (narrow() === wasNarrow) return;
      wasNarrow = narrow();
      if (!wasNarrow && document.body.getAttribute("data-view") === "list") onHash();
      setView(document.body.getAttribute("data-view") || "page");
    });
    wireKeyboard();
  }

  function boot() {
    applyI18n();
    wire();
    inheritPalette();
    watchPalette();
    setView(narrow() && !currentRoute() ? "list" : "page");
    Promise.all([
      getJson(stamped(TOPICS_URL)).then(function (d) {
        topics = (d && Array.isArray(d.topics) ? d.topics : [])
          .filter(function (x) { return x && ID_RE.test(x.id); })
          .map(function (x) { return { id: x.id }; });
      }).catch(function () { topics = []; }),
      getJson(APPS_URL).then(function (d) {
        apps = (d && Array.isArray(d.apps) ? d.apps : [])
          .filter(function (a) { return a && a.type !== "external" && ID_RE.test(a.id); });
      }).catch(function () { apps = []; })
    ]).then(fillTopicTitles).then(function () {
      renderNav();
      onHash();
      setTimeout(buildIndex, 300);
    });
  }

  boot();
})();
