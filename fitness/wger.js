// ============================================================
// orOS Workouts — wger.js (exercise pictures from wger.de, v1.0.0)
// Only when the user taps "Show picture" on an exercise:
//   1. search  https://wger.de/api/v2/exercise/search/?language=en&term=…
//      → the first suggestion with an image (exercise id, name, image)
//   2. details https://wger.de/api/v2/exerciseinfo/<id>/
//      → the image's author and licence (wger's exercise images are
//      CC BY-SA), shown next to the picture with links.
// No key, no bulk download, one exercise at a time. JSON comes straight
// from the browser; when wger answers without CORS headers, the Reader's
// shared network layer (feeds/fetch.js, its relay "web" op, loaded by
// path on first use) is tried. Images are plain <img> from wger.de; when
// the server allows CORS they are also kept in Cache Storage
// ("oros-fitness-pics") so they show offline. What was found per
// exercise (address + attribution, or "none") is kept on this device in
// localStorage "oros-fitness-pics" — never synced.
// Pure parts (pickSuggestion, parseInfo, absUrl, safeUrl) are tested in
// tests/fitness-wave29.test.js.
// window.OrosFitnessWger (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var BASE = "https://wger.de";
  var META_KEY = "oros-fitness-pics";
  var CACHE = "oros-fitness-pics";
  var MAX_META = 300;
  var NONE_TTL = 30 * 86400000;     // ask again for "no picture" after 30 days
  var DEF_LICENSE = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };

  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 200) : "";
  }
  // Only absolute http(s) addresses survive (links and images).
  function safeUrl(u) {
    u = str(u, 1000);
    return /^https:\/\/[^\s"'<>\\]+$/i.test(u) ? u : "";
  }
  // "/media/x.png" or "https://wger.de/media/x.png" → absolute https URL on wger.de
  function absUrl(p) {
    p = str(p, 1000);
    if (/^\/[^\/\s]/.test(p)) return safeUrl(BASE + p);
    if (p.indexOf(BASE + "/") === 0) return safeUrl(p);
    return "";
  }
  function fold(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  // Search answer → { id, name, image } | null. Prefers an exact name
  // match with an image, then any suggestion with an image.
  function pickSuggestion(json, name) {
    var list = json && Array.isArray(json.suggestions) ? json.suggestions : [];
    var want = fold(name), best = null;
    list.forEach(function (s) {
      var d = s && s.data;
      if (!d || typeof d !== "object") return;
      var id = typeof d.base_id === "number" ? d.base_id : (typeof d.exercise === "number" ? d.exercise : d.id);
      var img = absUrl(d.image);
      if (!(typeof id === "number" && id > 0 && Math.floor(id) === id) || !img) return;
      var c = { id: id, name: str(d.name || s.value, 120), image: img, exact: fold(d.name || s.value) === want };
      if (!best || (c.exact && !best.exact)) best = c;
    });
    if (!best) return null;
    return { id: best.id, name: best.name, image: best.image };
  }

  // exerciseinfo answer → attribution for the chosen image.
  // { author, authorUrl, license, licenseUrl, page }
  function parseInfo(json, imageUrl, id) {
    var out = { author: "", authorUrl: "", license: DEF_LICENSE.name, licenseUrl: DEF_LICENSE.url,
                page: BASE + "/en/exercise/" + id + "/view-base" };
    if (!json || typeof json !== "object") return out;
    var imgs = Array.isArray(json.images) ? json.images : [];
    var img = null;
    imgs.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var u = absUrl(x.image);
      if (u && u === imageUrl) img = x;
      else if (!img && x.is_main) img = x;
    });
    if (!img && imgs.length) img = imgs[0];
    var lic = json.license && typeof json.license === "object" ? json.license : null;
    if (img) {
      out.author = str(img.license_author, 120);
      out.authorUrl = safeUrl(img.license_author_url);
      var lid = typeof img.license === "object" && img.license ? img.license.id : img.license;
      if (img.license && typeof img.license === "object") lic = img.license;
      else if (lic && lid !== undefined && lic.id !== lid) lic = null;
    }
    if (lic) {
      var nm = str(lic.short_name || lic.full_name, 80);
      var lu = safeUrl(lic.url);
      if (nm) { out.license = nm; out.licenseUrl = lu || (/by-sa/i.test(nm) ? DEF_LICENSE.url : ""); }
    }
    return out;
  }

  // ---------- browser side ----------
  function loadMeta() {
    var m = null;
    try { m = JSON.parse(root.localStorage.getItem(META_KEY)); } catch (e) {}
    return m && typeof m === "object" && m.x && typeof m.x === "object" ? m : { v: 1, x: {} };
  }
  function saveMeta(m) {
    var keys = Object.keys(m.x);
    if (keys.length > MAX_META) {
      keys.sort(function (a, b) { return (m.x[a].at || 0) - (m.x[b].at || 0); });
      keys.slice(0, keys.length - MAX_META).forEach(function (k) { delete m.x[k]; });
    }
    try { root.localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
  }
  // What is known for an exercise: { pic } | { none: true } | null (never asked)
  function known(exId) {
    var r = loadMeta().x[exId];
    if (!r) return null;
    if (r.none) return Date.now() - (r.at || 0) < NONE_TTL ? { none: true } : null;
    return r.u ? { pic: r } : null;
  }
  function forget(exId) {
    var m = loadMeta(), r = m.x[exId];
    delete m.x[exId];
    saveMeta(m);
    if (r && r.u && root.caches) { try { root.caches.open(CACHE).then(function (c) { c.delete(r.u); }); } catch (e) {} }
  }

  var feedsP = null;
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = root.document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = bad;
      root.document.head.appendChild(s);
    });
  }
  function feeds() {
    if (root.orosFeedsFetch) return Promise.resolve(root.orosFeedsFetch);
    if (!feedsP) {
      feedsP = (root.orosFeedsCore ? Promise.resolve() : loadScript("../feeds/core.js"))
        .then(function () { return loadScript("../feeds/fetch.js"); })
        .then(function () { return root.orosFeedsFetch; });
    }
    return feedsP;
  }
  function getJson(url) {
    var direct = root.fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
                                   headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw { http: r.status };
        return r.json();
      });
    return direct.catch(function (e) {
      if (e && e.http) throw e;                          // the server answered: no relay
      return feeds().then(function (F) {
        if (!F || !F.relayAvailable()) throw e;
        return F.fetchOne(url, { via: "relay", accept: "application/json" }).then(function (r) {
          if (r.status !== 200) throw { http: r.status };
          return JSON.parse(r.text);
        });
      });
    });
  }
  function cacheImage(url) {
    if (!root.caches) return Promise.resolve();
    return root.fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) {
      if (!r.ok || !/^image\//i.test(r.headers.get("Content-Type") || "")) return;
      return root.caches.open(CACHE).then(function (c) { return c.put(url, r); });
    }).catch(function () {});
  }
  // An address for <img>: the cached copy (object URL) or the original.
  function imageSrc(url) {
    if (!root.caches) return Promise.resolve(url);
    return root.caches.open(CACHE).then(function (c) { return c.match(url); }).then(function (r) {
      return r ? r.blob().then(function (b) { return root.URL.createObjectURL(b); }) : url;
    }).catch(function () { return url; });
  }

  // terms: search words, most specific first (English ready name, own name)
  // → Promise<{ pic } | { none: true }>; rejects { offline | http | net }
  function lookup(exId, terms) {
    if (root.navigator && root.navigator.onLine === false) return Promise.reject({ offline: true });
    var i = 0;
    function next() {
      if (i >= terms.length) return Promise.resolve(null);
      var term = terms[i++];
      if (!term) return next();
      return getJson(BASE + "/api/v2/exercise/search/?language=en&term=" + encodeURIComponent(term))
        .then(function (j) { return pickSuggestion(j, term) || next(); });
    }
    return next().then(function (hit) {
      var m = loadMeta();
      if (!hit) { m.x[exId] = { none: 1, at: Date.now() }; saveMeta(m); return { none: true }; }
      return getJson(BASE + "/api/v2/exerciseinfo/" + hit.id + "/")
        .catch(function () { return null; })
        .then(function (info) {
          var a = parseInfo(info, hit.image, hit.id);
          var row = { u: hit.image, id: hit.id, nm: hit.name, au: a.author, auu: a.authorUrl,
                      li: a.license, liu: a.licenseUrl, pg: a.page, at: Date.now() };
          var m2 = loadMeta();
          m2.x[exId] = row;
          saveMeta(m2);
          cacheImage(hit.image);
          return { pic: row };
        });
    });
  }

  var api = {
    BASE: BASE, META_KEY: META_KEY, DEF_LICENSE: DEF_LICENSE,
    safeUrl: safeUrl, absUrl: absUrl, pickSuggestion: pickSuggestion, parseInfo: parseInfo,
    known: known, forget: forget, lookup: lookup, imageSrc: imageSrc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosFitnessWger = api;
})(typeof window !== "undefined" ? window : globalThis);
