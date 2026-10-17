// ============================================================
// orOS Media Shelf — .orosshelf file (shelf/package.js,
// window.OrosShelfPackage). The descriptor of Media Shelf for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every title (books, films, series, music, podcasts, games),
// its history (starts, progress, finishes, drops) and the yearly goals
// in one orOS bundle; opening one ADDS what this device lacks, with
// its ids. Pure (no DOM, no storage), so the app and `node --test` run
// the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; shelf.js then runs the
//                            result through its own mergeShelf in
//                            saveNow, so sync carries it)
//   DESC.norm(data)          a file's data → { ver, items, sess, goals,
//                            tombs } with the same shape checks as
//                            shelf.js normItem / normSess / normGoal
//                            (shelf.js is a closed IIFE, so they are
//                            re-implemented here, kept in step by
//                            tests/bundle-shelf.test.js); LWW per id
//                            like mergeShelf, the file's own tombstones
//                            applied, a history entry whose title is
//                            not in the file goes
//   DESC.strip(state)        the slice → { ver, items, sess, goals }: no
//                            tombstones. Device prefs (tab, filter,
//                            sort), the reading reminder and the TMDB
//                            key live in their own keys, never here
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  shelf.md (readable) and shelf.csv (CSV
//                            with a formula guard)
//   kindOf(id, state)        "item" | "sess" | "goal" | ""
// No media: covers are links (Wikimedia / TMDB), kept as the item's
// own fields; the file has no media/.
// ============================================================
(function (root) {
  "use strict";

  // shelf.js section 1 / 2 constants
  var DATA_VER  = 1;
  var TYPES     = ["book", "film", "series", "album", "podcast", "game"];
  var STATES    = ["want", "now", "done", "drop"];
  var KINDS     = ["s", "p", "d", "x"];
  var FORMATS   = ["p", "e", "a"];
  var TITLE_LEN = 200, BY_LEN = 120, REV_LEN = 4000, SRC_LEN = 200, PLAT_LEN = 40;
  var TAG_LEN   = 30, MAX_TAGS = 10, MAX_SIZE = 100000, MAX_GOAL = 1000, NCOLORS = 10;
  var LIM = { items: 5000, sess: 100000, goals: 600 };

  var ID_RE = /^[a-z0-9]{6,40}$/;
  var GOAL_RE = /^(\d{4})-(book|film|series|album|podcast|game)$/;
  var ITEM_KEYS = ["id", "m", "a", "type", "title", "by", "year", "size", "fmt", "plat", "st",
                   "prio", "rate", "fav", "tags", "rev", "src", "col", "rel",
                   "cov", "cvby", "cvlc", "cvpg", "wd", "tmdb"];
  var EXTRA_RE = /^[a-z][a-z0-9]{0,15}$/;
  var COV_RE = /^https:\/\/(upload\.wikimedia\.org|image\.tmdb\.org)\/[^\s"'<>\\]{1,460}$/;
  var CVPG_RE = /^https:\/\/commons\.wikimedia\.org\/wiki\/[^\s"'<>\\]{1,440}$/;
  var WD_RE = /^Q[1-9][0-9]{0,11}$/;
  var TMDB_RE = /^(movie|tv)\/[1-9][0-9]{0,11}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  function clipLine(s, n) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function clipText(s, n) {
    if (typeof s !== "string") return "";
    return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
            .replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  }
  function intIn(v, lo, hi, dflt) { return isInt(v) && v >= lo && v <= hi ? v : dflt; }
  function normTags(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var x = clipLine(s, TAG_LEN).replace(/,/g, "");
      var k = fold(x);
      if (x && !seen[k] && out.length < MAX_TAGS) { seen[k] = 1; out.push(x); }
    });
    return out;
  }

  // shelf.js normItem (same checks, same output)
  function normItem(x) {
    if (!isObj(x) || typeof x.id !== "string" || !ID_RE.test(x.id) || !isInt(x.m) || x.m < 0) return null;
    var title = clipLine(x.title, TITLE_LEN);
    if (!title || TYPES.indexOf(x.type) < 0) return null;
    var o = {
      id: x.id, m: x.m, a: intIn(x.a, 0, 1e14, x.m),
      type: x.type, title: title, by: clipLine(x.by, BY_LEN),
      year: intIn(x.year, 0, 9999, 0), size: intIn(x.size, 0, MAX_SIZE, 0),
      fmt: x.type === "book" && FORMATS.indexOf(x.fmt) >= 0 ? x.fmt : (x.type === "book" ? "p" : ""),
      plat: x.type === "game" ? clipLine(x.plat, PLAT_LEN) : "",
      st: STATES.indexOf(x.st) >= 0 ? x.st : "want",
      prio: x.prio === 1 ? 1 : 0, rate: intIn(x.rate, 0, 10, 0), fav: x.fav === 1 ? 1 : 0,
      tags: normTags(x.tags), rev: clipText(x.rev, REV_LEN), src: clipLine(x.src, SRC_LEN),
      col: intIn(x.col, 0, NCOLORS - 1, 0)
    };
    if (isYmd(x.rel)) o.rel = x.rel;
    if (typeof x.cov === "string" && COV_RE.test(x.cov)) {
      o.cov = x.cov;
      var cb = clipLine(x.cvby, BY_LEN), cl = clipLine(x.cvlc, 60);
      if (cb) o.cvby = cb;
      if (cl) o.cvlc = cl;
      if (typeof x.cvpg === "string" && CVPG_RE.test(x.cvpg)) o.cvpg = x.cvpg;
    }
    if (typeof x.wd === "string" && WD_RE.test(x.wd)) o.wd = x.wd;
    if (typeof x.tmdb === "string" && TMDB_RE.test(x.tmdb)) o.tmdb = x.tmdb;
    // a newer device's flat extra fields ride along (e.g. lib, the
    // Library link), as in shelf.js
    Object.keys(x).filter(function (k) {
      if (ITEM_KEYS.indexOf(k) >= 0 || !EXTRA_RE.test(k)) return false;
      var v = x[k];
      return (typeof v === "string" && v.length <= 500) || typeof v === "boolean" ||
             (typeof v === "number" && isFinite(v));
    }).sort(cmpStr).slice(0, 16).forEach(function (k) { o[k] = x[k]; });
    return o;
  }
  function normSess(x) {
    if (!isObj(x) || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0 || typeof x.it !== "string" || !ID_RE.test(x.it) ||
        KINDS.indexOf(x.k) < 0 || !isYmd(x.d)) return null;
    var s = { id: x.id, m: x.m, it: x.it, k: x.k, d: x.d };
    if (x.k === "p") {
      if (!isInt(x.v) || x.v < 0 || x.v > MAX_SIZE) return null;
      s.v = x.v;
    }
    return s;
  }
  function normGoal(g) {
    if (!isObj(g) || !isInt(g.m) || g.m < 0) return null;
    return { m: g.m, n: intIn(g.n, 0, MAX_GOAL, 0) };
  }
  // LWW per id like shelf.js lwwList; a tombstone at least as new drops it
  function lww(list, fn, tombs, max) {
    var best = {};
    (Array.isArray(list) ? list : []).slice(0, max * 2).forEach(function (raw) {
      var x = fn(raw);
      if (!x) return;
      var cur = best[x.id];
      if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
    });
    return Object.keys(best).sort(cmpStr).filter(function (id) {
      return !(id in tombs && tombs[id] >= best[id].m);
    }).slice(0, max).map(function (id) { return best[id]; });
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var tombs = {};
    if (isObj(data.tombs)) Object.keys(data.tombs).forEach(function (id) {
      var v = data.tombs[id];
      if (ID_RE.test(id) && isInt(v) && v >= 0) tombs[id] = v;
    });
    var items = lww(data.items, normItem, tombs, LIM.items), have = {};
    items.forEach(function (it) { have[it.id] = 1; });
    var sess = lww(data.sess, normSess, tombs, LIM.sess).filter(function (s) { return have[s.it]; });
    var goals = {};
    if (isObj(data.goals)) Object.keys(data.goals).filter(function (k) { return GOAL_RE.test(k); })
      .sort(cmpStr).slice(0, LIM.goals).forEach(function (k) {
        var g = normGoal(data.goals[k]);
        if (g) goals[k] = g;
      });
    return { ver: DATA_VER, items: items, sess: sess, goals: goals, tombs: tombs };   // strip drops tombs
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return clone({ ver: DATA_VER,
                   items: Array.isArray(s.items) ? s.items : [],
                   sess: Array.isArray(s.sess) ? s.sess : [],
                   goals: isObj(s.goals) ? s.goals : {} });
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return f || /[",\r\n]/.test(s) ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function stars(r) { return r ? (r / 2).toString() : ""; }
  // One flat { en, el } table, same keys and English as shelf.js
  // (orosI18n packs: pack "shelf").
  var WORDS = {
    en: {
      "app": "Media Shelf", "goal.head": "Goals",
      "types.book": "Books", "types.film": "Films", "types.series": "Series",
      "types.album": "Music", "types.podcast": "Podcasts", "types.game": "Games",
      "st.want": "Want", "tab.now": "Now", "st.done": "Done", "st.drop": "Dropped"
    },
    el: {
      "app": "Το ράφι μου", "goal.head": "Στόχοι",
      "types.book": "Βιβλία", "types.film": "Ταινίες", "types.series": "Σειρές",
      "types.album": "Μουσική", "types.podcast": "Podcasts", "types.game": "Παιχνίδια",
      "st.want": "Θέλω", "tab.now": "Τώρα", "st.done": "Ολοκληρώθηκε", "st.drop": "Το παράτησα"
    }
  };
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && I.known(lang) && !WORDS[lang]) I.table(WORDS, "shelf", lang);
    return WORDS[lang] || WORDS.en;
  }
  function previews(state, lang) {
    var w = words(lang);
    var TN = {}, SN = { want: w["st.want"], now: w["tab.now"], done: w["st.done"], drop: w["st.drop"] };
    TYPES.forEach(function (tp) { TN[tp] = w["types." + tp]; });
    var items = (state && Array.isArray(state.items) ? state.items : []).slice()
      .sort(function (a, b) { return cmpStr(fold(a.title), fold(b.title)) || cmpStr(a.id, b.id); });
    // the latest start and finish of each title
    var last = {};
    (state && Array.isArray(state.sess) ? state.sess : []).forEach(function (s) {
      var l = last[s.it] || (last[s.it] = { s: "", d: "" });
      if (s.k === "s" && s.d > l.s) l.s = s.d;
      if (s.k === "d" && s.d > l.d) l.d = s.d;
    });
    var md = ["# " + w["app"], ""];
    var csv = [["type", "title", "by", "year", "status", "rating", "favourite", "tags", "started", "finished", "review"].join(",")];
    TYPES.forEach(function (tp) {
      var list = items.filter(function (it) { return it.type === tp; });
      if (!list.length) return;
      md.push("## " + TN[tp], "");
      list.forEach(function (it) {
        var l = last[it.id] || { s: "", d: "" }, extra = [SN[it.st] || it.st];
        if (it.year) extra.push(String(it.year));
        if (it.rate) extra.push(stars(it.rate) + "★");
        if (l.d) extra.push(l.d);
        md.push("- " + (it.fav ? "♥ " : "") + "**" + it.title + "**" + (it.by ? " · " + it.by : "") + " (" + extra.join(", ") + ")");
        if (it.rev) md.push("  > " + it.rev.replace(/\n+/g, " "));
        csv.push([tp, it.title, it.by, it.year || "", it.st, stars(it.rate), it.fav ? "yes" : "",
                  (it.tags || []).join("; "), l.s, l.d, it.rev || ""].map(csvCell).join(","));
      });
      md.push("");
    });
    var gk = state && isObj(state.goals) ? Object.keys(state.goals).sort(cmpStr) : [];
    var gl = gk.filter(function (k) { return state.goals[k].n > 0; });
    if (gl.length) {
      md.push("## " + w["goal.head"], "");
      gl.forEach(function (k) {
        var m = GOAL_RE.exec(k);
        md.push("- " + m[1] + " · " + TN[m[2]] + ": " + state.goals[k].n);
      });
      md.push("");
    }
    return { "shelf.md": md.join("\n"), "shelf.csv": csv.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    if ((s.items || []).some(function (x) { return x.id === id; })) return "item";
    if ((s.sess || []).some(function (x) { return x.id === id; })) return "sess";
    if (isObj(s.goals) && Object.prototype.hasOwnProperty.call(s.goals, id)) return "goal";
    return "";
  }

  var DESC = {
    app: "shelf", title: "Media Shelf", slice: "shelf", ext: ".orosshelf", mime: "application/x-oros-shelf",
    colls: {
      items: { shape: "array", id: "id", stamp: "m" },
      sess: { shape: "array", id: "id", stamp: "m" },
      goals: { shape: "map", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM, normItem: normItem, normSess: normSess, normGoal: normGoal };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosShelfPackage = api;
})(this);
