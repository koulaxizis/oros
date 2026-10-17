// ============================================================
// orOS Flashcards — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads the
// deck list (oros-flashcards-data) and the note files on the orOS
// disk (/internal/Flashcards/Notes, through the shell's orosFS) and
// never writes. Deleted notes are left out. Opening goes through
// the generic deep link __orosOpenAt: decks { deck }, notes { note }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-flashcards-data";
  var DIR = "/internal/Flashcards/Notes";
  var FILE_RE = /^[0-9a-z]{4,16}-\d{6}\.json$/;
  var CLOZE_RE = /\{\{c\d{1,3}::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;
  var MAX_FILES = 400;

  // Plain text: cloze marks, **bold** / *italic* marks and list bullets out.
  function flat(s) {
    return String(s || "").replace(CLOZE_RE, "$1").replace(/^\s*(?:[-\u2022]|\d{1,4}[.)])\s+/gm, "")
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1").replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1").replace(/\s+/g, " ").trim();
  }

  // Newest version of every note id across the files.
  function readNotes(fs) {
    if (!fs || typeof fs.ls !== "function" || typeof fs.readText !== "function") return Promise.resolve({});
    return Promise.resolve(fs.ls(DIR)).catch(function () { return []; }).then(function (list) {
      var names = (list || []).filter(function (e) { return e && !e.dir && FILE_RE.test(e.name); })
        .map(function (e) { return e.name; }).slice(0, MAX_FILES);
      return Promise.all(names.map(function (n) {
        return Promise.resolve(fs.readText(DIR + "/" + n)).then(function (txt) {
          try { var x = JSON.parse(txt); return x && x.kind === "notes" && Array.isArray(x.items) ? x.items : []; }
          catch (e) { return []; }
        }, function () { return []; });
      }));
    }).then(function (files) {
      var map = {};
      files.forEach(function (items) {
        items.forEach(function (n) {
          if (!n || typeof n.id !== "string" || !(n.m > 0)) return;
          var o = map[n.id];
          if (!o || n.m > o.m || (n.m === o.m && n.del && !o.del)) map[n.id] = n;
        });
      });
      return map;
    });
  }

  var PROVIDER = {
    id: "flashcards",
    keys: [KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      var d = ctx.readJSON(KEY) || {};
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var hits = [];
      var names = {};
      (Array.isArray(d.decks) ? d.decks : []).forEach(function (x) {
        if (!x || typeof x.id !== "string" || typeof x.n !== "string" || tombs[x.id] >= x.m) return;
        names[x.id] = x.n;
        if (x.n.trim()) hits.push({ id: "deck:" + x.id, title: x.n.trim(), text: "", target: { deck: x.id } });
      });
      var fs = null;
      try { fs = root && root.orosFS; } catch (e) { fs = null; }
      return readNotes(fs).then(function (map) {
        Object.keys(map).sort().forEach(function (id) {
          var n = map[id];
          if (n.del || !n.f || typeof n.f !== "object") return;
          var title = n.k === "cloze" ? flat(n.f.x) : flat(n.f.q);
          var rest = n.k === "cloze" ? flat(n.f.e) : flat(n.f.a);
          if (!title && !rest) return;
          var tags = Array.isArray(n.tg) ? n.tg.join(" ") : "";
          hits.push({
            id: "note:" + id, title: (title || rest).slice(0, 80),
            text: [rest, tags, names[n.dk] || ""].join(" ").trim(), target: { note: id }
          });
        });
        return hits;
      });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
