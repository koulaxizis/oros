// ============================================================
// orOS Reader — .orosfeeds file (feeds/package.js,
// window.OrosFeedsPackage). The descriptor of the Reader for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every subscription, folder, saved article (starred, read
// later, tagged), tag and rule in one orOS bundle; opening one ADDS
// what this device lacks, with its ids. Pure (no DOM, no storage),
// so the app and `node --test` run the same code. Needs core.js
// (window.orosFeedsCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js merge
//                            (pure, symmetric: per id, newer m wins),
//                            which only ever sees the records the kit
//                            let through, so a clash keeps the local
//                            record; this device's settings, read state
//                            and tombstones stay as they are
//   DESC.norm(data)          a file's data → core.js merge(data, null):
//                            the app's own record checks (ids, feed id
//                            = hash of its address, http(s) links,
//                            clipped one-line text), capped counts
//   DESC.strip(state)        the slice → { ver, feeds, folders, items,
//                            tags, rules }: no tombstones, no settings
//                            (relay address, refresh, view …), no read
//                            state. Downloaded articles (IndexedDB) are
//                            never in the slice, so never in the file
//   DESC.tombIds(state)      the ids in state.tombs ("f:id" → "id")
//   DESC.previews(state, l)  feeds.opml (core.js buildOpml, the app's
//                            own "Export OPML") and saved.md (the saved
//                            articles, readable)
//   kindOf(id, state)        "feed" | "folder" | "item" | "tag" |
//                            "rule" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.orosFeedsCore;
  // read at most this many per collection before core.js merge caps
  // them again (MAX_FEEDS, MAX_SAVED …)
  var LIM = { feeds: 5000, folders: 1000, items: 5000, tags: 1000, rules: 1000 };
  var COLLS = ["feeds", "folders", "items", "tags", "rules"];
  var TEXT = ["title", "name", "author", "sum", "q"];
  var CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/g;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function norm(data) {
    if (!isObj(data)) return null;
    var src = {};
    COLLS.forEach(function (k) { src[k] = Array.isArray(data[k]) ? data[k].slice(0, LIM[k]) : []; });
    if (isObj(data.tombs)) src.tombs = data.tombs;   // a record the file itself deleted goes
    var out = C.merge(src, null);
    // core.js keeps control characters (its oneLine folds only white
    // space): a file's text loses them
    COLLS.forEach(function (k) {
      out[k].forEach(function (r) {
        TEXT.forEach(function (f) { if (typeof r[f] === "string") r[f] = r[f].replace(CTRL, " "); });
      });
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: C.DATA_VER };
    COLLS.forEach(function (k) { out[k] = Array.isArray(s[k]) ? s[k] : []; });
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    if (!isObj(state) || !isObj(state.tombs)) return [];
    return Object.keys(state.tombs).filter(function (k) { return /^[fdirt]:/.test(k); }).map(function (k) { return k.slice(2); });
  }

  // Markdown text: one line, no markup that could become a link or a heading
  function mdText(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/([\\\x60*_\[\]<>|])/g, "\\$1").trim();
  }
  // Text inside the file's readable copies. Shares the "feeds" pack
  // with feeds.js (same key = same English).
  var PV = {
    en: { "app": "Reader", "pkg.saved": "Saved articles", "pkg.starred": "starred", "pkg.later": "read later" },
    el: { "app": "Αναγνώστης", "pkg.saved": "Αποθηκευμένα άρθρα", "pkg.starred": "αστέρι", "pkg.later": "για αργότερα" }
  };
  function previews(state, lang) {
    var I = typeof window !== "undefined" && window.orosI18n, out = {};
    if (I && lang && !PV[lang]) I.table(PV, "feeds", lang);
    var w = PV[lang] || PV.en;
    var s = isObj(state) ? state : {};
    var data = { feeds: Array.isArray(s.feeds) ? s.feeds : [], folders: Array.isArray(s.folders) ? s.folders : [] };
    if (data.feeds.length) out["feeds.opml"] = C.buildOpml(data, "orOS " + w.app, Date.now());
    var items = Array.isArray(s.items) ? s.items : [];
    if (items.length) {
      var feeds = {}, tags = {};
      data.feeds.forEach(function (f) { feeds[f.id] = f.title; });
      (Array.isArray(s.tags) ? s.tags : []).forEach(function (g) { tags[g.id] = g.name; });
      var md = ["# " + w["pkg.saved"], ""];
      items.slice().sort(function (a, b) { return (b.date || 0) - (a.date || 0); }).forEach(function (x) {
        var marks = [];
        if (x.star) marks.push(w["pkg.starred"]);
        if (x.later) marks.push(w["pkg.later"]);
        (x.tags || []).forEach(function (t) { if (tags[t]) marks.push("#" + tags[t]); });
        var head = mdText(x.title) || "—";
        var line = "- " + (x.link ? "[" + head + "](<" + String(x.link).replace(/[<>\s]/g, encodeURIComponent) + ">)" : head);
        var meta = [];
        if (feeds[x.feed]) meta.push(mdText(feeds[x.feed]));
        if (x.date) meta.push(new Date(x.date).toISOString().slice(0, 10));
        if (marks.length) meta.push(mdText(marks.join(", ")));
        md.push(line + (meta.length ? " (" + meta.join(" · ") + ")" : ""));
      });
      out["saved.md"] = md.join("\n") + "\n";
    }
    return out;
  }

  // What an id names in a state (Undo removes each the app's way).
  // The ids carry their kind as the first letter (core.js okId).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    var map = { feeds: "feed", folders: "folder", items: "item", tags: "tag", rules: "rule" }, k = "";
    COLLS.forEach(function (c) {
      (Array.isArray(s[c]) ? s[c] : []).forEach(function (x) { if (x && x.id === id) k = k || map[c]; });
    });
    return k;
  }

  var DESC = {
    app: "feeds", title: "Reader", slice: "feeds", ext: ".orosfeeds", mime: "application/x-oros-feeds",
    colls: {
      feeds: { shape: "array", id: "id", stamp: "m" },
      folders: { shape: "array", id: "id", stamp: "m" },
      items: { shape: "array", id: "id", stamp: "m" },
      tags: { shape: "array", id: "id", stamp: "m" },
      rules: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.merge(local, remote); }
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosFeedsPackage = api;
})(this);
