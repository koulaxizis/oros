// ============================================================
// orOS designkit — media.js (open media sources, v1.0.0)
// Shared by the design apps (Atelier, Layout). Owner: Atelier.
//
// Searches open media libraries from the browser, keeps the
// licence of every result, writes the credit lines, and makes
// downloaded SVG safe before anything draws it. No app state, no
// storage: the caller passes fetch / cache / keys in `env`.
//
// Sources (Part VI "external services" in the Bible):
//   openverse  photos, illustrations, audio      no key
//   commons    photos, drawings, audio, video    no key
//   iconify    icons / clipart (SVG)             no key
//   fontsource font catalog + font files         no key
//   pixabay    photos, illustrations, video      user's own key
//   pexels     photos, video                     user's own key
//
// API (window.orosDK.media, or module.exports under Node):
//   VER, KINDS, SOURCES, LICENSES
//   sourcesFor(kind, keys)        source ids that can search a kind
//   request(src, kind, q, o)      { url, headers, cacheKey } (pure)
//   parse(src, kind, json, o)     { items[], total, more } (pure)
//   search(src, kind, q, o, env)  Promise of the same + { error }
//   licenseOf(code, ver)          licence facts, or null
//   normLicense(src, raw)         { lic, ver } from a source's wording
//   allowed(item, policy)         may this result be offered?
//   credit(item, lang)            one credit line (plain text)
//   credits(items, lang)          deduped, sorted credit lines
//   normCredit(c)                 canonical credit record (synced)
//   cleanText(s, max)             plain text from remote metadata
//   safeUrl(u)                    https URL or ""
//   sanitizeSvg(text)             { svg, w, h } or null
//   fontFiles(detail, wght, st)   { <subset>: { ttf, woff2 } }
//   fetchMedia(item, env)         Promise<Blob> (browser)
// Sections:
//   1. Constants + licences
//   2. Text and URL hygiene
//   3. Sources (request + parse)
//   4. Search runner
//   5. Credits
//   6. SVG sanitizer
//   7. Downloads
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

  // ---------- 1. Constants + licences ----------

  // photo = photographs, illus = illustrations / drawings / vectors.
  var KINDS = ["photo", "illus", "icon", "audio", "video", "font"];
  var PAGE = 24;                    // results per page, every source
  var MAX_TEXT = 200;               // title / author length kept
  var CACHE_MS = 24 * 3600 * 1000;  // Pixabay asks for 24 h; used for all

  // commercial: may be used in work that earns money
  // modify:     may be cropped, filtered, recoloured
  // credit:     the author must be named
  // share:      derivatives must carry the same licence
  var LICENSES = {
    "cc0":        { label: "CC0",          url: "https://creativecommons.org/publicdomain/zero/1.0/", commercial: true,  modify: true,  credit: false, share: false },
    "pdm":        { label: "Public Domain", url: "https://creativecommons.org/publicdomain/mark/1.0/", commercial: true,  modify: true,  credit: false, share: false },
    "by":         { label: "CC BY",        url: "https://creativecommons.org/licenses/by/",       commercial: true,  modify: true,  credit: true,  share: false },
    "by-sa":      { label: "CC BY-SA",     url: "https://creativecommons.org/licenses/by-sa/",    commercial: true,  modify: true,  credit: true,  share: true },
    "by-nc":      { label: "CC BY-NC",     url: "https://creativecommons.org/licenses/by-nc/",    commercial: false, modify: true,  credit: true,  share: false },
    "by-nc-sa":   { label: "CC BY-NC-SA",  url: "https://creativecommons.org/licenses/by-nc-sa/", commercial: false, modify: true,  credit: true,  share: true },
    "by-nd":      { label: "CC BY-ND",     url: "https://creativecommons.org/licenses/by-nd/",    commercial: true,  modify: false, credit: true,  share: false },
    "by-nc-nd":   { label: "CC BY-NC-ND",  url: "https://creativecommons.org/licenses/by-nc-nd/", commercial: false, modify: false, credit: true,  share: false },
    // Code licences of icon sets (MIT, Apache, ISC, BSD, OFL…): free
    // for any use; the notice belongs with redistributed copies of
    // the set, not inside a design. Listed in the credits anyway.
    "permissive": { label: "Open licence", url: "",                                                commercial: true,  modify: true,  credit: false, share: false },
    "pixabay":    { label: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/", commercial: true, modify: true, credit: false, share: false },
    "pexels":     { label: "Pexels License", url: "https://www.pexels.com/license/",              commercial: true,  modify: true,  credit: false, share: false },
    "font":       { label: "Open font licence", url: "",                                           commercial: true,  modify: true,  credit: false, share: false },
    // Anything else (GFDL-only, GPL, sampling+, unknown wording):
    // shown only when the user asks for restricted licences too.
    "other":      { label: "Other licence", url: "",                                               commercial: false, modify: false, credit: true,  share: false }
  };

  function licenseOf(code, ver) {
    var L = LICENSES[code];
    if (!L) return null;
    var out = { code: code, label: L.label, url: L.url, commercial: L.commercial,
                modify: L.modify, credit: L.credit, share: L.share };
    if (ver && /^by/.test(code)) {
      out.label = L.label + " " + ver;
      out.url = L.url + ver + "/";
    }
    return out;
  }

  var CC_RE = /^\s*cc[\s-]*(by(?:[\s-]*(?:sa|nc|nd))*)\s*(\d(?:\.\d)?)?/i;

  // A source's own wording → { lic, ver }. Unknown wording is "other".
  function normLicense(src, raw) {
    var s = String(raw == null ? "" : raw).trim();
    var low = s.toLowerCase();
    if (src === "pixabay") return { lic: "pixabay", ver: "" };
    if (src === "pexels") return { lic: "pexels", ver: "" };
    if (src === "fontsource") return { lic: "font", ver: "" };
    if (src === "openverse") {
      // Openverse codes: cc0, pdm, by, by-sa, by-nc, by-nd, by-nc-sa,
      // by-nc-nd, sampling+, nc-sampling+.
      if (LICENSES[low] && /^(cc0|pdm|by(-nc)?(-sa|-nd)?)$/.test(low)) return { lic: low, ver: "" };
      return { lic: "other", ver: "" };
    }
    if (src === "iconify") {
      // SPDX ids from the collection's licence record.
      if (/^cc0/i.test(s)) return { lic: "cc0", ver: "" };
      var m = /^cc-by(-nc)?(-sa|-nd)?-(\d\.\d)$/i.exec(s);
      if (m) return { lic: ("by" + (m[1] || "") + (m[2] || "")).toLowerCase(), ver: m[3] };
      if (/^(mit|apache-2\.0|isc|bsd-[23]-clause|ofl-1\.1|unlicense|0bsd)$/i.test(s)) return { lic: "permissive", ver: "" };
      return { lic: "other", ver: "" };
    }
    if (src === "commons") {
      // extmetadata LicenseShortName, e.g. "CC BY-SA 4.0", "CC0",
      // "Public domain", "CC BY 2.5 dk", "GFDL", "FAL".
      if (/^cc0\b|^cc[\s-]*zero/i.test(s)) return { lic: "cc0", ver: "" };
      if (/^(public domain|pd\b|pd-)/i.test(s)) return { lic: "pdm", ver: "" };
      var c = CC_RE.exec(s);
      if (c) {
        var parts = c[1].toLowerCase().replace(/\s+/g, "-").split("-").filter(Boolean);
        var code = "by";
        if (parts.indexOf("nc") >= 0) code += "-nc";
        if (parts.indexOf("sa") >= 0) code += "-sa";
        else if (parts.indexOf("nd") >= 0) code += "-nd";
        if (LICENSES[code]) return { lic: code, ver: c[2] || "" };
      }
      return { lic: "other", ver: "" };
    }
    return { lic: "other", ver: "" };
  }

  // policy.restricted: also offer NC / ND / other licences.
  function allowed(item, policy) {
    if (!item || !LICENSES[item.lic]) return false;
    if (policy && policy.restricted) return true;
    var L = LICENSES[item.lic];
    return L.commercial && L.modify;
  }

  // ---------- 2. Text and URL hygiene ----------

  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (all, e) {
      var cp;
      if (e.charAt(0) === "#") {
        cp = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return "";
        return String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      }
      return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : all;
    });
  }

  // Remote metadata → one line of plain text. Commons "Artist" is
  // HTML: tags go, entities are decoded, control characters and
  // runs of spaces collapse. The result is still shown only with
  // textContent; this is about readability, not the only defence.
  function cleanText(s, max) {
    if (s == null) return "";
    var t = String(s);
    t = t.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ");
    t = t.replace(/<[^>]*>/g, " ");
    t = decodeEntities(t);
    t = t.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    max = max || MAX_TEXT;
    if (t.length > max) t = t.slice(0, max - 1).trim() + "…";
    return t;
  }

  // Only plain https URLs: no credentials, no odd ports, no spaces.
  function safeUrl(u) {
    if (typeof u !== "string") return "";
    var s = u.trim();
    if (s.indexOf("//") === 0) s = "https:" + s;
    var m = /^https:\/\/([a-z0-9.-]+)(\/[^\s"'<>\\]*)?$/i.exec(s);
    if (!m) return "";
    if (/^[.-]|[.-]$|\.\./.test(m[1])) return "";
    return "https://" + m[1].toLowerCase() + (m[2] || "/");
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function enc(s) { return encodeURIComponent(s); }

  function qs(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== "" && o[k] != null; })
      .map(function (k) { return enc(k) + "=" + enc(o[k]); }).join("&");
  }

  function item(src, id, kind, f) {
    var lic = f.lic || { lic: "other", ver: "" };
    return {
      src: src,
      id: src + ":" + String(id),
      kind: kind,
      title: cleanText(f.title),
      author: cleanText(f.author),
      authorUrl: safeUrl(f.authorUrl),
      page: safeUrl(f.page),
      thumb: safeUrl(f.thumb),
      full: safeUrl(f.full),
      w: num(f.w),
      h: num(f.h),
      dur: f.dur > 0 ? Math.round(f.dur * 10) / 10 : 0,
      mime: typeof f.mime === "string" ? f.mime.toLowerCase().slice(0, 60) : "",
      lic: lic.lic,
      licVer: lic.ver || "",
      licUrl: safeUrl(f.licUrl)
    };
  }

  // A result is kept only if it has something to show and to fetch.
  function usable(it) {
    if (!it.full) return false;
    if ((it.kind === "photo" || it.kind === "illus" || it.kind === "icon" || it.kind === "video") && !it.thumb) return false;
    return true;
  }

  // ---------- 3. Sources (request + parse) ----------

  var SOURCES = {
    openverse: {
      name: "Openverse", home: "https://openverse.org", key: false,
      kinds: ["photo", "illus", "audio"],
      request: function (kind, q, o) {
        var p = { q: q, page: o.page, page_size: PAGE, mature: "false" };
        if (!o.restricted) p.license_type = "commercial,modification";
        if (kind === "photo") p.category = "photograph";
        if (kind === "illus") p.category = "illustration,digitized_artwork";
        var path = kind === "audio" ? "audio" : "images";
        return { url: "https://api.openverse.org/v1/" + path + "/?" + qs(p) };
      },
      parse: function (kind, j, o) {
        var res = (j && j.results) || [];
        var items = res.map(function (r) {
          return item("openverse", r.id, kind, {
            title: r.title, author: r.creator, authorUrl: r.creator_url,
            page: r.foreign_landing_url, full: r.url,
            // The thumbnail endpoint is Openverse's own (CORS-friendly);
            // r.thumbnail can be null for audio without artwork.
            thumb: r.thumbnail || (kind === "audio" ? "" : r.url),
            w: r.width, h: r.height, dur: num(r.duration) / 1000,
            mime: r.filetype ? (kind === "audio" ? "audio/" : "image/") + r.filetype : "",
            lic: { lic: normLicense("openverse", r.license).lic, ver: r.license_version || "" },
            licUrl: r.license_url
          });
        });
        var total = num(j && j.result_count);
        var pages = num(j && j.page_count);
        return { items: items, total: total, more: (o.page || 1) < pages };
      }
    },

    commons: {
      name: "Wikimedia Commons", home: "https://commons.wikimedia.org", key: false,
      kinds: ["photo", "illus", "audio", "video"],
      request: function (kind, q, o) {
        var ft = { photo: "bitmap", illus: "drawing", audio: "audio", video: "video" }[kind];
        var p = {
          action: "query", format: "json", formatversion: "2", origin: "*",
          generator: "search", gsrnamespace: "6", gsrlimit: PAGE,
          gsroffset: ((o.page || 1) - 1) * PAGE,
          gsrsearch: q + " filetype:" + ft,
          prop: "imageinfo", iiprop: "url|size|mime|extmetadata",
          iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ObjectName|AttributionRequired",
          iiurlwidth: kind === "audio" ? "" : "480"
        };
        return { url: "https://commons.wikimedia.org/w/api.php?" + qs(p) };
      },
      parse: function (kind, j, o) {
        var pages = (j && j.query && j.query.pages) || [];
        if (!Array.isArray(pages)) pages = Object.keys(pages).map(function (k) { return pages[k]; });
        pages = pages.slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        var items = pages.map(function (pg) {
          var ii = (pg.imageinfo && pg.imageinfo[0]) || {};
          var md = ii.extmetadata || {};
          var val = function (k) { return md[k] && md[k].value != null ? md[k].value : ""; };
          var title = val("ObjectName") || String(pg.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
          var lic = normLicense("commons", cleanText(val("LicenseShortName"), 60));
          return item("commons", pg.pageid, kind, {
            title: title, author: val("Artist"), page: ii.descriptionurl,
            full: ii.url, thumb: ii.thumburl || "", w: ii.width, h: ii.height,
            dur: Number(ii.duration) || 0, mime: ii.mime, lic: lic, licUrl: val("LicenseUrl")
          });
        });
        return { items: items, total: 0, more: !!(j && j.continue) };
      }
    },

    iconify: {
      name: "Iconify", home: "https://icon-sets.iconify.design", key: false,
      kinds: ["icon"],
      request: function (kind, q, o) {
        var p = { query: q, limit: PAGE * 4, start: ((o.page || 1) - 1) * PAGE * 4 };
        return { url: "https://api.iconify.design/search?" + qs(p) };
      },
      parse: function (kind, j, o) {
        var cols = (j && j.collections) || {};
        var items = ((j && j.icons) || []).map(function (full) {
          var m = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(String(full));
          if (!m) return null;
          var c = cols[m[1]] || {};
          var L = c.license || {};
          var url = "https://api.iconify.design/" + m[1] + "/" + m[2] + ".svg";
          return item("iconify", full, "icon", {
            title: m[2].replace(/-/g, " "), author: (c.author && c.author.name) || c.name || m[1],
            authorUrl: c.author && c.author.url, page: "https://icon-sets.iconify.design/" + m[1] + "/" + m[2] + "/",
            full: url, thumb: url, mime: "image/svg+xml",
            lic: normLicense("iconify", L.spdx || L.title), licUrl: L.url
          });
        }).filter(Boolean);
        var total = num(j && j.total);
        var start = num(j && j.start);
        return { items: items, total: total, more: !!total && start + items.length < total && items.length > 0 };
      }
    },

    fontsource: {
      name: "Fontsource", home: "https://fontsource.org", key: false,
      kinds: ["font"],
      // One request lists the whole catalog (filtered to Greek when
      // asked); the query is matched locally in parse().
      request: function (kind, q, o) {
        var p = { type: "google" };
        if (o.greek !== false) p.subsets = "greek";
        return { url: "https://api.fontsource.org/v1/fonts?" + qs(p) };
      },
      parse: function (kind, j, o) {
        var needle = String(o.q || "").toLowerCase().trim();
        var list = Array.isArray(j) ? j : [];
        var all = list.filter(function (f) {
          return f && /^[a-z0-9-]{1,60}$/.test(f.id) && typeof f.family === "string";
        }).filter(function (f) {
          return !needle || f.family.toLowerCase().indexOf(needle) >= 0 || String(f.category || "").indexOf(needle) >= 0;
        }).sort(function (a, b) { return a.family < b.family ? -1 : a.family > b.family ? 1 : 0; });
        var page = o.page || 1;
        var items = all.slice((page - 1) * PAGE, page * PAGE).map(function (f) {
          var it = item("fontsource", f.id, "font", {
            title: f.family, author: "", page: "https://fontsource.org/fonts/" + f.id,
            full: "https://api.fontsource.org/v1/fonts/" + f.id, thumb: "",
            lic: normLicense("fontsource")
          });
          it.family = cleanText(f.family, 60);
          it.category = cleanText(f.category, 20);
          it.weights = (Array.isArray(f.weights) ? f.weights : []).filter(function (w) { return w % 100 === 0 && w >= 100 && w <= 900; });
          it.styles = (Array.isArray(f.styles) ? f.styles : []).filter(function (s) { return s === "normal" || s === "italic"; });
          it.greek = Array.isArray(f.subsets) && f.subsets.indexOf("greek") >= 0;
          return it;
        });
        return { items: items, total: all.length, more: page * PAGE < all.length };
      }
    },

    pixabay: {
      name: "Pixabay", home: "https://pixabay.com", key: true,
      kinds: ["photo", "illus", "video"],
      request: function (kind, q, o) {
        var p = { key: o.key, q: q.slice(0, 100), page: o.page, per_page: PAGE, safesearch: "true",
                  lang: o.lang === "el" ? "el" : "en" };
        if (kind !== "video") p.image_type = kind === "photo" ? "photo" : "illustration";
        var base = kind === "video" ? "https://pixabay.com/api/videos/?" : "https://pixabay.com/api/?";
        var p2 = {}; Object.keys(p).forEach(function (k) { if (k !== "key") p2[k] = p[k]; });
        return { url: base + qs(p), cacheKey: base + qs(p2) };
      },
      parse: function (kind, j, o) {
        var items = ((j && j.hits) || []).map(function (h) {
          if (kind === "video") {
            var v = (h.videos && (h.videos.medium || h.videos.small || h.videos.large)) || {};
            return item("pixabay", h.id, "video", {
              title: h.tags, author: h.user, page: h.pageURL, full: v.url, thumb: v.thumbnail,
              w: v.width, h: v.height, dur: h.duration, mime: "video/mp4", lic: normLicense("pixabay")
            });
          }
          return item("pixabay", h.id, kind, {
            title: h.tags, author: h.user, page: h.pageURL,
            full: h.largeImageURL || h.webformatURL, thumb: h.webformatURL || h.previewURL,
            w: h.imageWidth, h: h.imageHeight, lic: normLicense("pixabay")
          });
        });
        var total = num(j && j.totalHits);
        return { items: items, total: total, more: (o.page || 1) * PAGE < total };
      }
    },

    pexels: {
      name: "Pexels", home: "https://www.pexels.com", key: true,
      kinds: ["photo", "video"],
      request: function (kind, q, o) {
        var p = { query: q, page: o.page, per_page: PAGE, locale: o.lang === "el" ? "el-GR" : "en-US" };
        var url = (kind === "video" ? "https://api.pexels.com/videos/search?" : "https://api.pexels.com/v1/search?") + qs(p);
        return { url: url, headers: { Authorization: o.key } };
      },
      parse: function (kind, j, o) {
        var list = kind === "video" ? (j && j.videos) || [] : (j && j.photos) || [];
        var items = list.map(function (p) {
          if (kind === "video") {
            var files = (p.video_files || []).filter(function (f) { return f && /mp4|webm/.test(f.file_type || ""); })
              .sort(function (a, b) { return (a.width || 0) - (b.width || 0); });
            var pick = files.filter(function (f) { return (f.width || 0) >= 960; })[0] || files[files.length - 1] || {};
            return item("pexels", p.id, "video", {
              title: "", author: p.user && p.user.name, authorUrl: p.user && p.user.url, page: p.url,
              full: pick.link, thumb: p.image, w: pick.width, h: pick.height, dur: p.duration,
              mime: pick.file_type, lic: normLicense("pexels")
            });
          }
          var s = p.src || {};
          return item("pexels", p.id, "photo", {
            title: p.alt, author: p.photographer, authorUrl: p.photographer_url, page: p.url,
            full: s.large2x || s.original, thumb: s.medium || s.small, w: p.width, h: p.height,
            lic: normLicense("pexels")
          });
        });
        var total = num(j && j.total_results);
        return { items: items, total: total, more: !!(j && j.next_page) };
      }
    }
  };

  function sourcesFor(kind, keys) {
    return Object.keys(SOURCES).filter(function (id) {
      var S = SOURCES[id];
      return S.kinds.indexOf(kind) >= 0 && (!S.key || (keys && typeof keys[id] === "string" && keys[id].trim()));
    });
  }

  function normQuery(q) {
    return String(q == null ? "" : q).replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function opts(o) {
    o = o || {};
    var page = Math.floor(Number(o.page));
    return {
      page: page >= 1 && page <= 500 ? page : 1,
      restricted: !!o.restricted,
      lang: o.lang === "el" ? "el" : "en",
      key: typeof o.key === "string" ? o.key.trim() : "",
      greek: o.greek !== false,
      q: ""
    };
  }

  function request(src, kind, q, o) {
    var S = SOURCES[src];
    if (!S || S.kinds.indexOf(kind) < 0) return null;
    var oo = opts(o);
    var qq = normQuery(q);
    if (!qq && src !== "fontsource") return null;
    if (S.key && !oo.key) return null;
    var r = S.request(kind, qq, oo);
    return { url: r.url, headers: r.headers || {}, cacheKey: r.cacheKey || r.url };
  }

  function parse(src, kind, json, o) {
    var S = SOURCES[src];
    if (!S) return { items: [], total: 0, more: false };
    var oo = opts(o);
    oo.q = normQuery(o && o.q);
    var r;
    try { r = S.parse(kind, json, oo); }
    catch (e) { return { items: [], total: 0, more: false, error: "format" }; }
    var seen = {};
    var items = r.items.filter(function (it) {
      if (!it || seen[it.id] || !usable(it)) return false;
      seen[it.id] = 1;
      return allowed(it, { restricted: oo.restricted });
    });
    return { items: items, total: r.total || 0, more: !!r.more };
  }

  // ---------- 4. Search runner ----------

  // env = { fetch, now(), cache: { get(key) → Promise<{t, json}|null>,
  //         put(key, {t, json}) → Promise }, keys: { pixabay, pexels } }
  // Errors come back as { error }: "offline", "rate", "key",
  // "server", "format", "bad-request". Never throws.
  function search(src, kind, q, o, env) {
    env = env || {};
    var S = SOURCES[src];
    var oo = {};
    Object.keys(o || {}).forEach(function (k) { oo[k] = o[k]; });
    if (S && S.key) oo.key = env.keys && env.keys[src];
    oo.q = q;
    var req = request(src, kind, q, oo);
    if (!req) return Promise.resolve({ items: [], total: 0, more: false, error: S && S.key && !oo.key ? "key" : "bad-request" });
    var now = env.now ? env.now() : Date.now();
    var cache = env.cache;
    var getCached = cache ? Promise.resolve().then(function () { return cache.get(req.cacheKey); }).catch(function () { return null; })
                          : Promise.resolve(null);
    return getCached.then(function (hit) {
      if (hit && hit.json != null && now - hit.t < CACHE_MS) return parse(src, kind, hit.json, oo);
      if (!env.fetch) return { items: [], total: 0, more: false, error: "offline" };
      return Promise.resolve().then(function () {
        return env.fetch(req.url, { headers: req.headers, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
      }).then(function (res) {
        if (res.status === 429) return { error: "rate" };
        if (res.status === 401 || res.status === 403) return { error: "key" };
        if (!res.ok) return { error: "server" };
        return res.json().then(function (json) {
          var out = parse(src, kind, json, oo);
          if (!out.error && cache) {
            Promise.resolve().then(function () { return cache.put(req.cacheKey, { t: now, json: json }); }).catch(function () {});
          }
          return out;
        }, function () { return { error: "format" }; });
      }, function () {
        // A stale copy beats nothing when the network is gone.
        if (hit && hit.json != null) return parse(src, kind, hit.json, oo);
        return { error: "offline" };
      }).then(function (out) {
        if (out.error && !out.items) { out.items = []; out.total = 0; out.more = false; }
        return out;
      });
    });
  }

  // ---------- 5. Credits ----------

  var CREDIT_FIELDS = { src: 20, id: 160, kind: 8, title: MAX_TEXT, author: MAX_TEXT, authorUrl: 500, page: 500, lic: 12, licVer: 8, licUrl: 500 };

  // What a design stores for one placed asset (travels through
  // sync): fixed key order, every field clipped (R26).
  function normCredit(c) {
    if (!c || typeof c !== "object" || !SOURCES[c.src] || !LICENSES[c.lic]) return null;
    var out = {};
    Object.keys(CREDIT_FIELDS).forEach(function (k) {
      var v = c[k] == null ? "" : String(c[k]);
      if (/url$|^page$/i.test(k)) v = v ? safeUrl(v) : "";
      else if (k === "title" || k === "author") v = cleanText(v, CREDIT_FIELDS[k]);
      else v = v.slice(0, CREDIT_FIELDS[k]);
      out[k] = v;
    });
    if (out.id.indexOf(out.src + ":") !== 0) return null;
    if (KINDS.indexOf(out.kind) < 0) return null;
    if (out.licVer && !/^\d(\.\d)?$/.test(out.licVer)) out.licVer = "";
    return out;
  }

  function credit(it, lang) {
    var c = normCredit(it);
    if (!c) return "";
    var el = lang === "el";
    var title = c.title ? (el ? "«" + c.title + "»" : "“" + c.title + "”") : (el ? "Χωρίς τίτλο" : "Untitled");
    // EN: “Title” by Author, CC BY 4.0, via Openverse
    // EL: «Τίτλος», δημιουργός: Author, CC BY 4.0, μέσω Openverse
    var line = title;
    if (c.author) line += el ? ", δημιουργός: " + c.author : " by " + c.author;
    if (c.lic !== "font") line += ", " + licenseOf(c.lic, c.licVer).label;
    return line + ", " + (el ? "μέσω " : "via ") + SOURCES[c.src].name;
  }

  // Credit lines for a design: one per asset (deduped by id), the
  // ones that REQUIRE a credit first, then alphabetical.
  function credits(items, lang) {
    var seen = {};
    var rows = [];
    (items || []).forEach(function (it) {
      var c = normCredit(it);
      if (!c || seen[c.id]) return;
      seen[c.id] = 1;
      rows.push({ need: LICENSES[c.lic].credit ? 0 : 1, line: credit(c, lang) });
    });
    rows.sort(function (a, b) { return a.need - b.need || (a.line < b.line ? -1 : a.line > b.line ? 1 : 0); });
    return rows.map(function (r) { return r.line; });
  }

  // ---------- 6. SVG sanitizer ----------
  // Our own small XML reader, so the result does not depend on how a
  // browser parser recovers from broken markup. Everything not on the
  // lists below is dropped with its whole subtree (script,
  // foreignObject, style, image, a@href to elsewhere, animation…).
  // A DOCTYPE with an internal subset (entity tricks) rejects the file.

  var SVG_MAX = 1024 * 1024;     // characters
  var SVG_MAX_NODES = 20000;
  var SVG_MAX_DEPTH = 64;

  var SVG_EL = {};
  ("svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop " +
   "clipPath mask symbol use pattern").split(" ").forEach(function (n) { SVG_EL[n] = 1; });
  var SVG_UNWRAP = { a: 1 };     // keep the drawing inside a link, drop the link

  var SVG_ATTR = {};
  ("id d cx cy r rx ry x y x1 y1 x2 y2 fx fy width height viewBox points fill stroke stroke-width " +
   "stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity " +
   "fill-opacity fill-rule clip-rule opacity transform clip-path mask offset stop-color stop-opacity " +
   "gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform " +
   "clipPathUnits maskUnits maskContentUnits preserveAspectRatio display visibility color vector-effect " +
   "pathLength paint-order href xlink:href").split(" ").forEach(function (n) { SVG_ATTR[n] = 1; });

  var CSS_PROPS = {};
  ("fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray " +
   "stroke-dashoffset stroke-opacity fill-opacity fill-rule clip-rule opacity stop-color stop-opacity " +
   "display visibility color clip-path mask paint-order vector-effect").split(" ").forEach(function (n) { CSS_PROPS[n] = 1; });

  function xmlUnescape(s) {
    var bad = false;
    var out = s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, function (all, e) {
      if (e.charAt(0) === "#") {
        var cp = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) { bad = true; return ""; }
        return String.fromCodePoint ? String.fromCodePoint(cp) : String.fromCharCode(cp);
      }
      var k = e.toLowerCase();
      if (k === "amp" || k === "lt" || k === "gt" || k === "quot" || k === "apos") return ENT[k];
      bad = true;
      return "";
    });
    return bad ? null : out;
  }

  function xmlEscape(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Values may point only inside the same file: url(#id) / #id.
  function safeValue(name, v) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return null;
    if (v.length > 200000) return null;
    if (name === "href" || name === "xlink:href") return /^#[A-Za-z_][\w.:-]{0,100}$/.test(v) ? v : null;
    var low = v.toLowerCase();
    if (/javascript:|data:|expression\s*\(|@import|\\/.test(low)) return null;
    var urls = low.match(/url\s*\(([^)]*)\)/g);
    if (urls && !urls.every(function (u) { return /^url\s*\(\s*['"]?#[\w.:-]+['"]?\s*\)$/.test(u); })) return null;
    return v;
  }

  function safeStyle(v) {
    var out = [];
    v.split(";").forEach(function (decl) {
      var i = decl.indexOf(":");
      if (i < 0) return;
      var p = decl.slice(0, i).trim().toLowerCase();
      var val = decl.slice(i + 1).trim();
      if (!CSS_PROPS[p] || !val) return;
      if (/!important/i.test(val)) val = val.replace(/!important/ig, "").trim();
      var ok = safeValue(p, val);
      if (ok != null && !/[{}<>]/.test(ok)) out.push(p + ":" + ok);
    });
    return out.join(";");
  }

  function svgLength(v) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(v || "");
    return m ? parseFloat(m[1]) : 0;
  }

  // Sticky (y) regexes read the file in place, without slicing it.
  var RE_CLOSE = /<\/([A-Za-z_][\w.:-]*)\s*>/y;
  var RE_OPEN = /<([A-Za-z_][\w.:-]*)/y;
  var RE_WS = /\s*/y;
  var RE_ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

  function sanitizeSvg(text) {
    if (typeof text !== "string" || !text || text.length > SVG_MAX) return null;
    var s = text.replace(/^﻿/, "");
    var i = 0, n = s.length;
    var out = [];
    var stack = [];          // { name, keep } of open elements
    var dropDepth = 0;       // > 0 while inside a dropped subtree
    var nodes = 0;
    var rootSeen = false, rootClosed = false;
    var w = 0, h = 0, vb = null;

    while (i < n) {
      var lt = s.indexOf("<", i);
      if (lt < 0) break;               // trailing text is ignored
      i = lt;
      if (s.substr(i, 4) === "<!--") {
        var ce = s.indexOf("-->", i + 4);
        if (ce < 0) return null;
        i = ce + 3; continue;
      }
      if (s.substr(i, 9) === "<![CDATA[") {
        var de = s.indexOf("]]>", i + 9);
        if (de < 0) return null;
        i = de + 3; continue;          // CDATA text is never kept
      }
      if (s.substr(i, 2) === "<?") {
        var pe = s.indexOf("?>", i + 2);
        if (pe < 0) return null;
        i = pe + 2; continue;
      }
      if (/^<!doctype/i.test(s.substr(i, 9))) {
        var gt0 = s.indexOf(">", i);
        if (gt0 < 0) return null;
        if (s.slice(i, gt0).indexOf("[") >= 0) return null;   // internal subset: entities
        i = gt0 + 1; continue;
      }
      if (s.charAt(i + 1) === "!") return null;

      if (s.charAt(i + 1) === "/") {   // closing tag
        RE_CLOSE.lastIndex = i;
        var ct = RE_CLOSE.exec(s);
        if (!ct || !stack.length || stack[stack.length - 1].name !== ct[1]) return null;
        var top = stack.pop();
        if (top.drop) dropDepth--;
        else if (top.keep) out.push("</" + top.name + ">");
        if (!stack.length) rootClosed = true;
        i += ct[0].length;
        continue;
      }

      // opening tag: name, attributes, optional "/"
      RE_OPEN.lastIndex = i;
      var nm = RE_OPEN.exec(s);
      if (!nm) return null;
      if (rootClosed) return null;     // a second root element
      var name = nm[1];
      var j = i + nm[0].length;
      var attrs = [];
      var selfClose = false;
      for (;;) {
        RE_WS.lastIndex = j;
        var ws = RE_WS.exec(s)[0];
        j += ws.length;
        if (s.charAt(j) === ">") { j++; break; }
        if (s.substr(j, 2) === "/>") { j += 2; selfClose = true; break; }
        if (!ws.length && attrs.length) return null;
        RE_ATTR.lastIndex = j;
        var am = RE_ATTR.exec(s);
        if (!am) return null;
        var raw = am[3] != null ? am[3] : am[4];
        if (raw.indexOf("<") >= 0) return null;
        attrs.push([am[1], raw]);
        j += am[0].length;
        if (j >= n) return null;
      }
      i = j;
      if (++nodes > SVG_MAX_NODES) return null;

      if (!rootSeen) {
        if (name !== "svg") return null;
        rootSeen = true;
      }
      var depth = stack.length + 1;
      if (depth > SVG_MAX_DEPTH) return null;

      var keep = false, drop = false;
      if (dropDepth > 0) drop = true;
      else if (SVG_EL[name]) keep = true;
      else if (SVG_UNWRAP[name]) keep = false;
      else drop = true;

      if (keep) {
        var parts = ["<" + name];
        if (name === "svg" && depth === 1) parts.push(' xmlns="http://www.w3.org/2000/svg"');
        var hasXlink = false;
        attrs.forEach(function (a) {
          var an = a[0], v = xmlUnescape(a[1]);
          if (v == null) return;
          if (an === "style") {
            var st = safeStyle(v);
            if (st) parts.push(' style="' + xmlEscape(st) + '"');
            return;
          }
          if (!SVG_ATTR[an]) return;
          var sv = safeValue(an, v);
          if (sv == null) return;
          if (an === "xlink:href") hasXlink = true;
          parts.push(" " + an + '="' + xmlEscape(sv) + '"');
          if (name === "svg" && depth === 1) {
            if (an === "width") w = svgLength(sv);
            if (an === "height") h = svgLength(sv);
            if (an === "viewBox") vb = sv;
          }
        });
        if (hasXlink) parts.splice(1, 0, ' xmlns:xlink="http://www.w3.org/1999/xlink"');
        out.push(parts.join("") + (selfClose ? "/>" : ">"));
      }
      if (!selfClose) {
        stack.push({ name: name, keep: keep, drop: drop });
        if (drop) dropDepth++;
      } else if (!stack.length) {
        rootClosed = true;
      }
    }
    if (!rootSeen || stack.length) return null;

    if ((!w || !h) && vb) {
      var nums = vb.trim().split(/[\s,]+/).map(Number);
      if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) { w = w || nums[2]; h = h || nums[3]; }
    }
    return { svg: out.join(""), w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
  }

  // ---------- 7. Downloads ----------

  // Fontsource font detail → files of one weight + style, per subset.
  function fontFiles(detail, wght, style) {
    var out = {};
    var v = detail && detail.variants && detail.variants[String(wght)];
    var st = v && v[style === "italic" ? "italic" : "normal"];
    if (!st || typeof st !== "object") return out;
    Object.keys(st).sort().forEach(function (sub) {
      if (!/^[a-z0-9-]{1,30}$/.test(sub)) return;
      var u = st[sub] && st[sub].url;
      if (!u) return;
      var ttf = safeUrl(u.ttf), woff2 = safeUrl(u.woff2);
      if (ttf || woff2) out[sub] = { ttf: ttf, woff2: woff2 };
    });
    return out;
  }

  var LIMITS = { photo: 25e6, illus: 25e6, icon: 1e6, audio: 30e6, video: 80e6, font: 5e6 };
  var MIME_OK = {
    photo: /^image\/(jpeg|png|webp|gif|avif)$/,
    illus: /^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/,
    icon: /^image\/svg\+xml$/,
    audio: /^(audio\/(mpeg|mp3|ogg|wav|x-wav|wave|flac|x-flac|webm|aac|mp4)|application\/ogg|video\/ogg)$/,
    video: /^(video\/(mp4|webm|ogg|quicktime)|application\/ogg)$/,
    font: /^(font\/(ttf|sfnt|woff2)|application\/(x-font-ttf|font-sfnt|octet-stream))$/
  };

  // Downloads one result (or url = a specific file such as a font)
  // without cookies or referrer. Resolves to a Blob whose type was
  // checked against the kind; an SVG comes back sanitized. Rejects
  // with Error("offline" | "server" | "type" | "size" | "svg").
  function fetchMedia(it, env, url) {
    var u = safeUrl(url || (it && it.full));
    if (!u || !env || !env.fetch) return Promise.reject(new Error("offline"));
    var kind = it.kind;
    return Promise.resolve().then(function () {
      return env.fetch(u, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" });
    }).then(function (res) {
      if (!res.ok) throw new Error("server");
      var len = Number(res.headers && res.headers.get && res.headers.get("content-length"));
      if (len && len > LIMITS[kind]) throw new Error("size");
      return res.blob();
    }, function (e) {
      if (e && (e.message === "server" || e.message === "size")) throw e;
      throw new Error("offline");
    }).then(function (blob) {
      if (blob.size > LIMITS[kind]) throw new Error("size");
      var type = String(blob.type || "").split(";")[0].trim().toLowerCase();
      if (!type && kind === "font") type = "font/ttf";
      if (!MIME_OK[kind].test(type)) throw new Error("type");
      if (type !== "image/svg+xml") return blob;
      return blob.text().then(function (t) {
        var clean = sanitizeSvg(t);
        if (!clean) throw new Error("svg");
        return new Blob([clean.svg], { type: "image/svg+xml" });
      });
    });
  }

  var API = {
    VER: VER,
    KINDS: KINDS.slice(),
    PAGE: PAGE,
    SOURCES: SOURCES,
    LICENSES: LICENSES,
    sourcesFor: sourcesFor,
    request: request,
    parse: parse,
    search: search,
    licenseOf: licenseOf,
    normLicense: normLicense,
    allowed: allowed,
    credit: credit,
    credits: credits,
    normCredit: normCredit,
    cleanText: cleanText,
    safeUrl: safeUrl,
    sanitizeSvg: sanitizeSvg,
    fontFiles: fontFiles,
    fetchMedia: fetchMedia
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else {
    root.orosDK = root.orosDK || {};
    root.orosDK.media = API;
  }
})(typeof window !== "undefined" ? window : this);
