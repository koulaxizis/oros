// ============================================================
// orOS One-Minute Museum — core (v1.0.0)
// Pure logic, no DOM: reading Wikipedia's REST answers into
// "exhibits", safe links, and the collection merge.
// Loaded by museum.js (window.MuseumCore) and by the tests (require).
//
// exhibit = {
//   id:      "en123" | "el456" (article) | "pf" + hash (picture of the day)
//   kind:    "article" | "picture"
//   lang:    "en" | "el"
//   title, desc (≤ 300), extract (≤ 2000), event (≤ 400, "On this day")
//   url:     article / file page, always on a fixed Wikimedia host
//   hist:    page history (the authors), same host
//   thumb:   image URL on upload.wikimedia.org, or ""
//   credit:  picture credit (artist · licence), or ""
// }
// Collection (sync slice "museum"):
//   { ver: 1, items: [exhibit + m], tombs: { id: deletedAt } }
// ============================================================
(function (root) {
  "use strict";

  var LANGS      = ["en", "el"];
  var MAX_TITLE  = 300;
  var MAX_DESC   = 300;
  var MAX_TEXT   = 2000;
  var MAX_EVENT  = 400;
  var MAX_CREDIT = 300;
  var MIN_TEXT   = 160;          // shorter intros are skipped as stubs
  var DATA_VER   = 1;
  var ID_RE      = /^(?:(?:en|el)\d{1,12}|pf[a-z0-9]{6,20})$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clip(s, n) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  // Wikipedia's "text" fields can carry markup; keep plain text only.
  function plain(s, n) {
    if (typeof s !== "string") return "";
    return clip(s.replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'"), n);
  }
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function lang(l) { return LANGS.indexOf(l) >= 0 ? l : "en"; }

  // ---------- Endpoints + links (fixed hosts only) ----------
  function apiBase(l) { return "https://" + lang(l) + ".wikipedia.org/api/rest_v1"; }
  function randomUrl(l) { return apiBase(l) + "/page/random/summary"; }
  function featuredUrl(l, d) {
    d = d || new Date();
    return apiBase(l) + "/feed/featured/" + d.getUTCFullYear() + "/" +
      ("0" + (d.getUTCMonth() + 1)).slice(-2) + "/" + ("0" + d.getUTCDate()).slice(-2);
  }
  function pageUrl(l, title) {
    return "https://" + lang(l) + ".wikipedia.org/wiki/" + encodeURIComponent(String(title).replace(/ /g, "_"));
  }
  function historyUrl(l, title) {
    return "https://" + lang(l) + ".wikipedia.org/w/index.php?title=" +
      encodeURIComponent(String(title).replace(/ /g, "_")) + "&action=history";
  }
  function fileUrl(fileTitle) {
    return "https://commons.wikimedia.org/wiki/" + encodeURIComponent(String(fileTitle).replace(/ /g, "_"));
  }
  // A link we built or accept: https on a Wikimedia page host.
  var LINK_RE = /^https:\/\/(?:(?:en|el)\.wikipedia\.org|commons\.wikimedia\.org)\/[^\s"<>]*$/;
  function safeLink(u) { return typeof u === "string" && LINK_RE.test(u) ? u : ""; }
  // Images only from Wikimedia's upload host.
  var IMG_RE = /^https:\/\/upload\.wikimedia\.org\/[^\s"<>()]+$/;
  function safeImg(u) { return typeof u === "string" && IMG_RE.test(u) ? u : ""; }

  // ---------- Reading answers ----------
  // A page summary (random, tfa, most read, on this day) → exhibit, or
  // { skip: reason } when it is not worth showing.
  function parseSummary(j, l, opts) {
    opts = opts || {};
    l = lang(l);
    if (!j || typeof j !== "object") return { skip: "bad" };
    if (j.type && j.type !== "standard") return { skip: j.type };       // disambiguation, no-extract…
    var title = clip(j.title, MAX_TITLE);
    var pid = j.pageid;
    if (!title || !isInt(pid) || pid <= 0 || pid > 999999999999) return { skip: "bad" };
    var extract = plain(j.extract, MAX_TEXT);
    if (!opts.anyLength && extract.length < MIN_TEXT) return { skip: "stub" };
    var thumb = safeImg(j.thumbnail && j.thumbnail.source) || safeImg(j.originalimage && j.originalimage.source);
    if (opts.needImage && !thumb) return { skip: "noimage" };
    return {
      id: l + pid, kind: "article", lang: l, title: title,
      desc: plain(j.description, MAX_DESC), extract: extract,
      event: plain(opts.event || "", MAX_EVENT),
      url: pageUrl(l, title), hist: historyUrl(l, title),
      thumb: thumb, credit: ""
    };
  }

  // Picture of the day (feed.image) → exhibit or { skip }.
  function parsePicture(img, l) {
    l = lang(l);
    if (!img || typeof img !== "object") return { skip: "bad" };
    var file = clip(img.title, MAX_TITLE);
    var thumb = safeImg(img.thumbnail && img.thumbnail.source) || safeImg(img.image && img.image.source);
    if (!file || !thumb) return { skip: "bad" };
    var desc = img.description && typeof img.description === "object" ? img.description.text : img.description;
    var artist = img.artist && typeof img.artist === "object" ? img.artist.text : img.artist;
    var lic = img.license && typeof img.license === "object" ? img.license.type : "";
    var credit = [plain(artist, 150), plain(lic, 60)].filter(Boolean).join(" · ");
    var name = file.replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ");
    return {
      id: "pf" + hash32(file).toString(36) + hash32("x" + file).toString(36),
      kind: "picture", lang: l, title: clip(name, MAX_TITLE),
      desc: "", extract: plain(desc, MAX_TEXT), event: "",
      url: fileUrl(file), hist: fileUrl(file) + "?action=history",
      thumb: thumb, credit: clip(credit, MAX_CREDIT)
    };
  }

  // The day's featured feed → a list of exhibits, in show order:
  // featured article, picture of the day, then the most read.
  // onThisDay: the "On this day" events instead (English only).
  function parseFeatured(f, l, onThisDay) {
    var out = [], seen = {};
    function add(x) { if (x && !x.skip && !seen[x.id]) { seen[x.id] = 1; out.push(x); } }
    if (!f || typeof f !== "object") return out;
    if (onThisDay) {
      (Array.isArray(f.onthisday) ? f.onthisday : []).forEach(function (ev) {
        if (!ev || !Array.isArray(ev.pages) || !ev.pages.length) return;
        var line = (isInt(ev.year) ? ev.year + ": " : "") + plain(ev.text, MAX_EVENT);
        for (var i = 0; i < ev.pages.length; i++) {
          var x = parseSummary(ev.pages[i], l, { event: line, anyLength: true });
          if (!x.skip && !seen[x.id]) { add(x); break; }
        }
      });
      return out;
    }
    add(parseSummary(f.tfa, l, { anyLength: true }));
    add(parsePicture(f.image, l));
    var most = f.mostread && Array.isArray(f.mostread.articles) ? f.mostread.articles : [];
    most.forEach(function (a) { add(parseSummary(a, l)); });
    return out;
  }

  // ---------- Collection: normalise + merge ----------
  function normItem(it) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id) ||
        !isInt(it.m) || it.m < 0) return null;
    var title = clip(it.title, MAX_TITLE), url = safeLink(it.url);
    if (!title || !url) return null;
    var kind = it.kind === "picture" ? "picture" : "article";
    if ((kind === "picture") !== (it.id.slice(0, 2) === "pf")) return null;
    return {
      id: it.id, m: it.m, kind: kind, lang: lang(it.lang), title: title,
      desc: clip(it.desc, MAX_DESC), extract: clip(it.extract, MAX_TEXT),
      event: clip(it.event, MAX_EVENT), url: url, hist: safeLink(it.hist),
      thumb: safeImg(it.thumb), credit: clip(it.credit, MAX_CREDIT)
    };
  }

  // LWW per item (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer save resurrects (R17).
  function mergeMuseum(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.items, b.items].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var it = normItem(raw);
        if (!it) return;
        var cur = best[it.id];
        if (!cur || it.m > cur.m ||
            (it.m === cur.m && JSON.stringify(it) > JSON.stringify(cur))) best[it.id] = it;
      });
    });
    var items = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      items.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, items: items, tombs: sortedTombs };
  }

  function findItem(dat, id) {
    for (var i = 0; i < dat.items.length; i++) if (dat.items[i].id === id) return dat.items[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  // A saved copy of an exhibit (what goes into the collection).
  function toItem(x, m) {
    var o = { m: m };
    ["id", "kind", "lang", "title", "desc", "extract", "event", "url", "hist", "thumb", "credit"]
      .forEach(function (k) { o[k] = x[k]; });
    return normItem(o);
  }
  // Fisher–Yates with an injected random (0 ≤ r() < 1).
  function shuffle(list, r) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var api = {
    LANGS: LANGS, MAX_TITLE: MAX_TITLE, MAX_TEXT: MAX_TEXT, MIN_TEXT: MIN_TEXT, ID_RE: ID_RE,
    clip: clip, plain: plain, hash32: hash32,
    randomUrl: randomUrl, featuredUrl: featuredUrl, pageUrl: pageUrl, historyUrl: historyUrl,
    fileUrl: fileUrl, safeLink: safeLink, safeImg: safeImg,
    parseSummary: parseSummary, parsePicture: parsePicture, parseFeatured: parseFeatured,
    normItem: normItem, mergeMuseum: mergeMuseum, findItem: findItem, newestFirst: newestFirst,
    toItem: toItem, shuffle: shuffle
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseumCore = api;
})(typeof window !== "undefined" ? window : this);
