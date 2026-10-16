// ============================================================
// orOS Podcasts — .orospodcasts file (podcasts/package.js,
// window.OrosPodcastsPackage). The descriptor of Podcasts for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every subscription with its settings and the listening
// progress of its episodes in one orOS bundle; opening one ADDS what
// this device lacks, with its ids. Pure (no DOM, no storage), so the
// app and `node --test` run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; podcasts.js then runs the
//                            result through fold() and the host's
//                            mutate, which canonicalises and syncs)
//   DESC.norm(data)          a file's data → { ver, shows } with
//                            core.js's own shape checks (mergePodcasts),
//                            capped; episodes of shows not in the file
//                            are dropped
//   DESC.strip(state)        the slice → { ver, shows }: no tombstones,
//                            no queue, no prefs (this device's player
//                            settings); each show carries its "all older
//                            are played" floor as `fl` and its episode
//                            rows as `eps`, so they come and go with it
//   DESC.tombIds(state)      the unsubscribed show ids (state.tombs)
//   DESC.previews(state)     podcasts.opml (the shows, for any podcast app)
//   nest(state, keepTombs)   the slice → that shape (the app's hooks.get
//                            passes it with its tombstones)
//   fold(next)               that shape → { ver, shows, eps, floors }
//   opml(shows, title, now)  OPML 2.0 text of the shows (also the
//                            app's "Export OPML")
// Never in the file: the gpodder config and password (device-local,
// "oros-podcasts-gpodder" + IndexedDB), downloaded audio, the feed
// cache, positions of this device ("oros-podcasts-local").
// ============================================================
(function (root) {
  "use strict";

  var C = root && root.OrosPodcastsCore;
  if (!C && typeof require === "function") C = require("./core.js").OrosPodcastsCore;
  var SHOW_RE = /^s[0-9a-z]{12,14}$/;
  var FUTURE = 5 * 60 * 1000;
  var LIM = { shows: (C && C.LIM && C.LIM.shows) || 500, eps: (C && C.LIM && C.LIM.eps) || 4000 };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isStamp(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0; }

  // The slice (or a file) → shows, each with its floor as `fl` and
  // its episode rows as `eps` (the kit's "shows.eps" collection, so
  // the progress of a show unsubscribed here is skipped with it).
  // Episode rows of shows not in the list are dropped.
  function nest(state, keepTombs) {
    var s = isObj(state) ? state : {}, floors = isObj(s.floors) ? s.floors : {}, by = {}, out = [];
    var shows = (Array.isArray(s.shows) ? s.shows : []).filter(function (x) { return isObj(x) && SHOW_RE.test(x.id); });
    shows.forEach(function (x) { by[x.id] = []; });
    function put(e) { if (isObj(e) && typeof e.s === "string" && by[e.s] && !by[e.s].some(function (y) { return y.id === e.id; })) by[e.s].push(e); }
    shows.forEach(function (x) { (Array.isArray(x.eps) ? x.eps : []).forEach(put); });
    (Array.isArray(s.eps) ? s.eps : []).forEach(put);
    shows.forEach(function (x) {
      if (out.some(function (y) { return y.id === x.id; })) return;
      var c = JSON.parse(JSON.stringify(x)), f = floors[x.id];
      if (isStamp(f) && f > 0) c.fl = f;
      else if (!(isStamp(x.fl) && x.fl > 0)) delete c.fl;
      c.eps = JSON.parse(JSON.stringify(by[x.id]));
      out.push(c);
    });
    var r = { ver: typeof s.ver === "number" ? s.ver : 1, shows: out };
    if (keepTombs && isObj(s.tombs)) r.tombs = JSON.parse(JSON.stringify(s.tombs));
    return r;
  }
  // Nested → flat ({ shows, eps, floors }), fl back into floors (max).
  function fold(next) {
    var d = isObj(next) ? next : {}, shows = [], eps = [], floors = {};
    Object.keys(isObj(d.floors) ? d.floors : {}).forEach(function (k) { floors[k] = d.floors[k]; });
    (Array.isArray(d.shows) ? d.shows : []).forEach(function (s) {
      if (!isObj(s)) return;
      var c = JSON.parse(JSON.stringify(s));
      if (SHOW_RE.test(c.id) && isStamp(c.fl) && c.fl > 0 && !(floors[c.id] >= c.fl)) floors[c.id] = c.fl;
      // a row filed under another show than its own is dropped
      (Array.isArray(c.eps) ? c.eps : []).forEach(function (e) { if (isObj(e) && e.s === c.id) eps.push(e); });
      delete c.fl; delete c.eps;
      shows.push(c);
    });
    (Array.isArray(d.eps) ? d.eps : []).forEach(function (e) { if (isObj(e)) eps.push(JSON.parse(JSON.stringify(e))); });
    return { ver: typeof d.ver === "number" ? d.ver : 1, shows: shows, eps: eps, floors: floors };
  }
  function norm(data) {
    if (!isObj(data) || !C) return null;
    var lim = Date.now() + FUTURE;
    var flat = fold({ shows: Array.isArray(data.shows) ? data.shows.slice(0, LIM.shows) : [],
                      eps: Array.isArray(data.eps) ? data.eps : [], floors: isObj(data.floors) ? data.floors : {} });
    flat.eps = flat.eps.slice(0, LIM.eps);
    flat.tombs = isObj(data.tombs) ? data.tombs : {};
    var m = C.mergePodcasts(flat, null);      // core's normShow / normEp / floors, the file's own tombstones
    m.shows.forEach(function (s) { if (s.at > lim) s.at = lim; });    // a future "subscribed at" hides new episodes
    Object.keys(m.floors).forEach(function (k) { if (m.floors[k] > lim) m.floors[k] = lim; });
    var out = nest(m, false);
    if (Object.keys(m.tombs).length) out.tombs = m.tombs;       // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) { return nest(state, false); }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // OPML 2.0 of the shows ({ url, title }), in their order.
  function opml(shows, title, now) {
    var out = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n<head>\n  <title>" + esc(title || "orOS Podcasts") +
      "</title>\n  <dateCreated>" + new Date(now || 0).toUTCString() + "</dateCreated>\n</head>\n<body>\n";
    (Array.isArray(shows) ? shows : []).forEach(function (s) {
      if (!isObj(s) || typeof s.url !== "string" || !/^https?:\/\//i.test(s.url)) return;
      var t = esc(s.title || s.url);
      out += "  <outline type=\"rss\" text=\"" + t + "\" title=\"" + t + "\" xmlUrl=\"" + esc(s.url) + "\"/>\n";
    });
    return out + "</body>\n</opml>\n";
  }
  function previews(state, lang) {
    var shows = isObj(state) && Array.isArray(state.shows) ? state.shows : [], modified = 0;
    shows.forEach(function (s) { if (s && s.m > modified) modified = s.m; });
    return { "podcasts.opml": opml(shows, lang === "el" ? "orOS Podcasts (συνδρομές)" : "orOS Podcasts (subscriptions)", modified) };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.shows || []).forEach(function (x) { if (x && x.id === id) k = "show"; });
    (s.eps || []).forEach(function (x) { if (x && x.id === id) k = k || "ep"; });
    (s.shows || []).forEach(function (x) { ((x && x.eps) || []).forEach(function (e) { if (e && e.id === id) k = k || "ep"; }); });
    return k;
  }

  var DESC = {
    app: "podcasts", title: "Podcasts", slice: "podcasts", ext: ".orospodcasts", mime: "application/x-oros-podcasts",
    colls: {
      shows: { shape: "array", id: "id", stamp: "m" },
      "shows.eps": { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, nest: nest, fold: fold, opml: opml, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosPodcastsPackage = api;
})(typeof window !== "undefined" ? window : this);
