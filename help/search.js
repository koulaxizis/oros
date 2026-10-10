// ============================================================
// orOS Help — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: Help keeps no user data, so this searches
// the GUIDE ITSELF, shipped with orOS: the topic pages
// (help/topics/<id>.<lang>.txt, ids from help/topics.json) and the
// app pages (<appId>/help.<lang>.txt, ids in HELP_APPS below — the
// apps that ship one; add an id there when an app gains its page).
// Pages are fetched once per language (same files and same ?v=
// stamp as help.js, so the service worker serves them offline),
// parsed with the same rules as help.js parsePage(), and kept in
// memory; the first search waits for them (a slow first load is
// skipped by the shell's 1 s limit, the next search has them).
// The current language is used, else English (as Help does).
// One hit per page: its title; the text of all its sections. The
// target names the section that best matches the words, with the
// same section ids help.js gives its headings. No date (`when`).
// Opens through the existing bridge window.orosHelp.open(route):
// target { route: "t/<id>[/<section>]" | "a/<id>[/<section>]" }.
// ============================================================
(function (root) {
  "use strict";

  var ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
  // Apps that ship a guide page (<id>/help.en.txt + help.el.txt).
  var HELP_APPS = ["assistant", "atelier", "bookmarks", "calendar", "contacts", "files", "help", "kanban",
                   "maps", "notes", "slides", "spreadsheet", "time", "todo", "weather", "writer"];
  // Fallback when topics.json cannot be read.
  var TOPICS = ["start", "menu", "install", "appearance", "sync", "backup", "data",
                "notifications", "shortcuts", "privacy", "reset", "troubleshooting", "faq"];

  // Where this file was loaded from (…/help/search.js?v=…): pages are
  // fetched next to it, stamped with the same release.
  var BASE = "", VER = "";
  try {
    var cs = root.document && root.document.currentScript;
    var src = cs && cs.src ? String(cs.src) : "";
    if (src) {
      var vm = /[?&]v=([^&#]+)/.exec(src);
      VER = vm ? vm[1] : "";
      BASE = src.split(/[?#]/)[0].replace(/[^/]*$/, "");
    }
  } catch (e) {}

  // ---------- Page parsing (mirrors help.js, text only) ----------
  function fold(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFD");
    return s.replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
  }
  function slugify(s) {
    return fold(s).replace(/[^a-z0-9α-ω]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  var INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;
  function inlineText(s) {
    s = String(s || "");
    return s.replace(INLINE_RE, function (all, b, code, kbd, linkText) {
      if (b !== undefined) return b;
      if (code !== undefined) return code;
      if (kbd !== undefined) {
        return kbd.split("+").map(function (k) { return k.trim(); }).filter(Boolean).join("+");
      }
      return linkText;
    });
  }
  // A page → { title, secs: [{ id, heading, text }] }; the part before
  // the first heading is section "" (the title).
  function parsePage(srcText) {
    var lines = String(srcText || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
    var title = "", secs = [{ id: "", heading: "", text: "" }], used = {};
    var cur = null;   // open block kind: p | tip | warn | ul | ol
    function uniq(base) {
      var id = base || "s", n = 2;
      while (used[id]) id = base + "-" + (n++);
      used[id] = 1;
      return id;
    }
    function add(s) {
      var sec = secs[secs.length - 1];
      s = inlineText(s);
      sec.text += (sec.text ? " " : "") + s;
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, ""), m;
      if (!line.trim()) { cur = null; return; }
      if ((m = /^#\s+(.+)$/.exec(line))) {
        cur = null;
        if (!title) title = m[1].trim(); else { add(m[1].trim()); cur = "p"; }
        return;
      }
      if ((m = /^(##|###)\s+(.+)$/.exec(line))) {
        cur = null;
        var text = m[2].trim();
        secs.push({ id: uniq(slugify(inlineText(text))), heading: inlineText(text), text: "" });
        return;
      }
      if ((m = /^>(!?)\s?(.*)$/.exec(line))) {
        cur = m[1] ? "warn" : "tip";
        add(m[2].trim());
        return;
      }
      if ((m = /^-\s+(.+)$/.exec(line)) || (m = /^\d{1,3}\.\s+(.+)$/.exec(line))) {
        cur = /^-/.test(line) ? "ul" : "ol";
        add(m[1].trim());
        return;
      }
      add(line.trim());
      if (cur !== "ul" && cur !== "ol") cur = "p";
    });
    secs[0].heading = title;
    return { title: title, secs: secs };
  }

  // ---------- Loading (once per language) ----------
  var loads = {};   // lang → Promise<[{ route, title, secs }]>
  var ready = {};   // lang → the same, once resolved

  function getText(url) {
    var f = root.fetch;
    if (typeof f !== "function") return Promise.reject(new Error("no fetch"));
    var u = BASE + url + (VER ? "?v=" + encodeURIComponent(VER) : "");
    return f.call(root, u).then(function (r) {
      if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
      return r.text();
    });
  }
  function pageIn(path, lang) {
    return getText(path + "." + lang + ".txt").catch(function () {
      if (lang === "en") throw new Error("missing");
      return getText(path + ".en.txt");
    });
  }
  function load(lang) {
    if (loads[lang]) return loads[lang];
    loads[lang] = getText("topics.json").then(function (txt) {
      var d = JSON.parse(txt);
      var ids = (d && Array.isArray(d.topics) ? d.topics : [])
        .map(function (x) { return x && x.id; }).filter(function (id) { return ID_RE.test(String(id || "")); });
      return ids.length ? ids : TOPICS;
    }).catch(function () { return TOPICS; }).then(function (topicIds) {
      var jobs = topicIds.map(function (id) { return ["t/" + id, "topics/" + id]; })
        .concat(HELP_APPS.map(function (id) { return ["a/" + id, "../" + id + "/help"]; }));
      return Promise.all(jobs.map(function (j) {
        return pageIn(j[1], lang).then(function (txt) {
          var p = parsePage(txt);
          return p.title ? { route: j[0], title: p.title, secs: p.secs } : null;
        }, function () { return null; });
      }));
    }).then(function (pages) {
      var list = pages.filter(Boolean);
      if (!list.length) { delete loads[lang]; return list; }   // offline first run: try again later
      ready[lang] = list;
      return list;
    });
    return loads[lang];
  }

  // ---------- Hits ----------
  function hitsFor(pages, ctx) {
    var words = Array.isArray(ctx.words) ? ctx.words : [];
    var f = typeof ctx.fold === "function" ? ctx.fold : fold;
    return pages.map(function (pg) {
      // The section with the most matching words (heading counts
      // more); ties → the earlier one. "" = the top of the page.
      var best = "", bestScore = 0;
      pg.secs.forEach(function (s, i) {
        if (!i) return;
        var fh = f(s.heading), ft = f(s.text), sc = 0;
        words.forEach(function (w) {
          if (fh.indexOf(w) !== -1) sc += 3;
          if (ft.indexOf(w) !== -1) sc += 1;
        });
        if (sc > bestScore) { bestScore = sc; best = s.id; }
      });
      return {
        id: pg.route,
        title: pg.title,
        text: pg.secs.map(function (s, i) {
          return (i ? s.heading + ". " : "") + s.text;
        }).filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
        target: { route: pg.route + (best ? "/" + best : "") }
      };
    });
  }

  var PROVIDER = {
    id: "help",
    keys: [],
    parsePage: parsePage,
    search: function (ctx) {
      var lang = ctx.lang === "el" ? "el" : "en";
      if (ready[lang]) return hitsFor(ready[lang], ctx);
      return load(lang).then(function (pages) { return hitsFor(pages, ctx); });
    },
    open: function (t, win) {
      var route = t && typeof t.route === "string" ? t.route : "";
      if (!/^([at]\/[a-z0-9-]+(\/[a-z0-9α-ω-]+)?)?$/.test(route)) route = "";
      if (win && win.orosHelp && typeof win.orosHelp.open === "function") win.orosHelp.open(route);
      else if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("help", null);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
