// ============================================================
// orOS Studio — podcast (v1.0.0, wave P1 of "Publish as podcast")
// Pure logic, no DOM, no Web Audio: a show and its episodes, chapter
// markers, the RSS feed (RSS 2.0 + Apple's itunes: tags + Podcasting
// 2.0's podcast: tags), the chapters file, a small web page for the
// show and a ZIP of the whole site laid out for any static host.
// Loaded by studio.js (window.StudioPodcast) and the tests.
//
// Data (sync slice "studio"; these ride through older Studios with the
// forward safety of wave A0, and are checked here when read):
//   shows: [{ id "h…", m, title, author, desc, lang, cat, sub, explicit,
//             type "episodic"|"serial", url (https, ends with "/"),
//             email, fund (http/https), cover (disk path), guid (UUID) }]
//   on a project (one episode = one Studio project):
//     sh: the show's id
//     ep: { n, se, type "full"|"trailer"|"bonus", title, desc, date (ms),
//           explicit, guid, slug, file (disk path of the MP3), bytes,
//           dur (s), kbps, ch (1|2), mh (markerHash of the markers its
//           chapters were made from: the site's chapters must match them) }
//     mk: [{ id "k…", t (s), n }] markers on the timeline, in time order
// The feed's podcast:guid is made once from the site address (UUIDv5,
// Podcasting 2.0) and an episode's guid once from the show's guid and
// the project; neither ever changes afterwards, so subscribers never
// see an episode twice or lose the show when it moves to another host.
// ============================================================
(function (root) {
  "use strict";

  var LIM = {
    title: 120, author: 120, showDesc: 4000, epDesc: 1500, url: 500, email: 120,
    markers: 50, mark: 40, epNo: 9999, season: 99, dur: 3600, bytes: 2147483647
  };
  var SHOW_RE  = /^h[a-z0-9]{6,20}$/;
  var MARK_RE  = /^k[a-z0-9]{6,20}$/;
  var UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var LANG_RE  = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
  var SLUG_RE  = /^[a-z0-9][a-z0-9-]{0,59}$/;
  var DIR      = "/internal/Studio/Podcasts";
  var PATH_RE  = /^\/internal\/Studio\/Podcasts\/h[a-z0-9]{6,20}\/[a-z0-9][a-z0-9.-]{0,79}$/;
  var KBPS     = [64, 96, 128];
  var EP_TYPES = ["full", "trailer", "bonus"];
  var TYPES    = ["episodic", "serial"];
  // Podcasting 2.0's namespace for podcast:guid (UUIDv5)
  var NS_PODCAST = "ead4c236-bf58-58c6-a2c6-a6b28d128cb6";
  // Apple Podcasts categories (the text the feed carries) and their subcategories
  var CATS = {
    "Arts": ["Books", "Design", "Fashion & Beauty", "Food", "Performing Arts", "Visual Arts"],
    "Business": ["Careers", "Entrepreneurship", "Investing", "Management", "Marketing", "Non-Profit"],
    "Comedy": ["Comedy Interviews", "Improv", "Stand-Up"],
    "Education": ["Courses", "How To", "Language Learning", "Self-Improvement"],
    "Fiction": ["Comedy Fiction", "Drama", "Science Fiction"],
    "Government": [],
    "History": [],
    "Health & Fitness": ["Alternative Health", "Fitness", "Medicine", "Mental Health", "Nutrition", "Sexuality"],
    "Kids & Family": ["Education for Kids", "Parenting", "Pets & Animals", "Stories for Kids"],
    "Leisure": ["Animation & Manga", "Automotive", "Aviation", "Crafts", "Games", "Hobbies", "Home & Garden", "Video Games"],
    "Music": ["Music Commentary", "Music History", "Music Interviews"],
    "News": ["Business News", "Daily News", "Entertainment News", "News Commentary", "Politics", "Sports News", "Tech News"],
    "Religion & Spirituality": ["Buddhism", "Christianity", "Hinduism", "Islam", "Judaism", "Religion", "Spirituality"],
    "Science": ["Astronomy", "Chemistry", "Earth Sciences", "Life Sciences", "Mathematics", "Natural Sciences", "Nature", "Physics", "Social Sciences"],
    "Society & Culture": ["Documentary", "Personal Journals", "Philosophy", "Places & Travel", "Relationships"],
    "Sports": ["Baseball", "Basketball", "Cricket", "Fantasy Sports", "Football", "Golf", "Hockey", "Rugby", "Running", "Soccer", "Swimming", "Tennis", "Volleyball", "Wilderness", "Wrestling"],
    "Technology": [],
    "True Crime": [],
    "TV & Film": ["After Shows", "Film History", "Film Interviews", "Film Reviews", "TV Reviews"]
  };

  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function isInt(n) { return isNum(n) && Math.floor(n) === n; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function okM(m) { return isInt(m) && m >= 0; }
  // one line: no control characters, trimmed, at most n characters
  function line(s, n) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  // text with line breaks kept (\n), other control characters dropped
  function text(s, n) {
    if (typeof s !== "string") return "";
    return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  }
  // an http(s) address, or "" (no user name or password in it)
  function webUrl(s, httpsOnly) {
    s = line(s, LIM.url);
    if (!s) return "";
    var m = /^(https?):\/\/([^\/?#\s@]+)([^\s]*)$/i.exec(s);
    if (!m || (httpsOnly && m[1].toLowerCase() !== "https") || /@/.test(m[3].split(/[\/?#]/)[0])) return "";
    return m[1].toLowerCase() + "://" + m[2].toLowerCase() + m[3];
  }
  // the address the site will live at: https, no query or fragment, ends with "/"
  function siteUrl(s) {
    var u = webUrl(s, true);
    if (!u || /[?#]/.test(u)) return "";
    return /\/$/.test(u) ? u : u + "/";
  }
  function email(s) {
    s = line(s, LIM.email);
    return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) ? s : "";
  }

  // ---------- 1. Normalise ----------
  function normShow(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !SHOW_RE.test(x.id) || !okM(x.m)) return null;
    var cat = typeof x.cat === "string" && CATS.hasOwnProperty(x.cat) ? x.cat : "";
    var sub = cat && typeof x.sub === "string" && CATS[cat].indexOf(x.sub) >= 0 ? x.sub : "";
    return {
      id: x.id, m: x.m,
      title: line(x.title, LIM.title),
      author: line(x.author, LIM.author),
      desc: text(x.desc, LIM.showDesc),
      lang: typeof x.lang === "string" && LANG_RE.test(x.lang) ? x.lang : "en",
      cat: cat, sub: sub,
      explicit: x.explicit === true,
      type: TYPES.indexOf(x.type) >= 0 ? x.type : "episodic",
      url: siteUrl(x.url),
      email: email(x.email),
      fund: webUrl(x.fund, false),
      cover: typeof x.cover === "string" && PATH_RE.test(x.cover) && /\.(jpg|png)$/.test(x.cover) ? x.cover : "",
      guid: typeof x.guid === "string" && UUID_RE.test(x.guid) ? x.guid : ""
    };
  }
  // markers: [{ id, t, n }] in time order (equal times: by id), at most LIM.markers
  function normMarkers(list) {
    if (!Array.isArray(list)) return [];
    var seen = {}, out = [];
    list.forEach(function (x) {
      if (!x || typeof x !== "object" || typeof x.id !== "string" || !MARK_RE.test(x.id) || seen[x.id] || !isNum(x.t)) return;
      seen[x.id] = true;
      out.push({ id: x.id, t: round(clamp(x.t, 0, LIM.dur), 3), n: line(x.n, LIM.mark) });
    });
    out.sort(function (a, b) { return a.t - b.t || cmpStr(a.id, b.id); });
    return out.slice(0, LIM.markers);
  }
  function normEp(x) {
    if (!x || typeof x !== "object") return null;
    var int = function (v, a, b) { return isInt(v) ? clamp(v, a, b) : 0; };
    var o = {
      n: int(x.n, 0, LIM.epNo),
      se: int(x.se, 0, LIM.season),
      type: EP_TYPES.indexOf(x.type) >= 0 ? x.type : "full",
      title: line(x.title, LIM.title),
      desc: text(x.desc, LIM.epDesc),
      date: isInt(x.date) && x.date > 0 ? x.date : 0,
      explicit: x.explicit === true,
      guid: typeof x.guid === "string" && UUID_RE.test(x.guid) ? x.guid : "",
      slug: typeof x.slug === "string" && SLUG_RE.test(x.slug) ? x.slug : "",
      file: typeof x.file === "string" && PATH_RE.test(x.file) && /\.mp3$/.test(x.file) ? x.file : "",
      bytes: int(x.bytes, 0, LIM.bytes),
      dur: isNum(x.dur) ? round(clamp(x.dur, 0, LIM.dur), 3) : 0,
      kbps: KBPS.indexOf(x.kbps) >= 0 ? x.kbps : 96,
      ch: x.ch === 2 ? 2 : 1,
      mh: typeof x.mh === "string" && /^[0-9a-f]{8}$/.test(x.mh) ? x.mh : ""
    };
    if (!o.file) { o.bytes = 0; o.dur = 0; o.mh = ""; }
    return o;
  }
  // the shows of the slice, checked, title order
  function shows(dat) {
    var list = dat && Array.isArray(dat.shows) ? dat.shows : [];
    return list.map(normShow).filter(Boolean).sort(function (a, b) {
      return cmpStr(a.title.toLowerCase(), b.title.toLowerCase()) || cmpStr(a.id, b.id);
    });
  }
  function findShow(dat, id) { return shows(dat).filter(function (s) { return s.id === id; })[0] || null; }
  // the episodes of a show: [{ p: project, ep, mk: its markers }], newest date first, unpublished drafts last
  function episodes(dat, showId) {
    var out = [];
    (dat && Array.isArray(dat.projects) ? dat.projects : []).forEach(function (p) {
      if (!p || p.sh !== showId) return;
      var ep = normEp(p.ep);
      if (ep) out.push({ p: p, ep: ep, mk: normMarkers(p.mk) });
    });
    return out.sort(function (a, b) {
      return (b.ep.file ? 1 : 0) - (a.ep.file ? 1 : 0) || b.ep.date - a.ep.date || b.ep.n - a.ep.n || cmpStr(a.p.id, b.p.id);
    });
  }
  function nextEpNo(dat, showId) {
    var n = 0;
    episodes(dat, showId).forEach(function (e) { if (e.ep.type === "full") n = Math.max(n, e.ep.n); });
    return Math.min(LIM.epNo, n + 1);
  }

  // ---------- 2. Markers (chapters) ----------
  function addMarker(list, t, id, name) {
    return normMarkers(normMarkers(list).concat([{ id: id, t: t, n: name || "" }]));
  }
  function setMarker(list, id, fields) {
    return normMarkers(normMarkers(list).map(function (x) { return x.id === id ? Object.assign({}, x, fields) : x; }));
  }
  function removeMarker(list, id) { return normMarkers(list).filter(function (x) { return x.id !== id; }); }
  // the chapters of an episode from its markers: [{ start, end, title }] in
  // seconds, inside [0, dur), markers within half a second of the last kept
  // one or of the end dropped; the first chapter starts at 0 (a marker
  // after 0 gets a chapter before it, titled `introTitle`)
  function chapters(markers, dur, introTitle) {
    var list = normMarkers(markers).filter(function (x) { return x.t < dur - 0.5; }), out = [];
    if (!list.length || !(dur > 0)) return [];
    if (list[0].t >= 0.5) out.push({ start: 0, title: line(introTitle, LIM.mark) });
    list.forEach(function (x) {
      var start = x.t < 0.5 ? 0 : x.t;
      if (out.length && start - out[out.length - 1].start < 0.5) return;
      out.push({ start: start, title: x.n });
    });
    out.forEach(function (c, i) { c.end = i + 1 < out.length ? out[i + 1].start : round(dur, 3); });
    return out;
  }
  // 8 hex digits that change when the markers do (times and names)
  function markerHash(list) {
    var h = sha1(utf8(JSON.stringify(normMarkers(list).map(function (x) { return [x.t, x.n]; }))));
    return h.slice(0, 4).map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
  }
  // the markers changed after the episode's file was made (its chapters are old)
  function stale(e) { return !!e.ep.file && e.ep.mh !== markerHash(e.mk); }
  // Podcasting 2.0 JSON chapters (application/json+chapters, version 1.2.0)
  function chaptersJson(chs, untitled) {
    return JSON.stringify({
      version: "1.2.0",
      chapters: chs.map(function (c, i) {
        return { startTime: round(c.start, 3), endTime: round(c.end, 3), title: c.title || (untitled ? untitled + " " + (i + 1) : String(i + 1)) };
      })
    }, null, 2) + "\n";
  }

  // ---------- 3. Names ----------
  // i18n-inline-ok: Greek letters → Latin for ASCII file names (data, no UI text)
  var GREEK = {
    "α": "a", "ά": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "έ": "e", "ζ": "z", "η": "i", "ή": "i", "θ": "th",
    "ι": "i", "ί": "i", "ϊ": "i", "ΐ": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "ό": "o",
    "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "ύ": "y", "ϋ": "y", "ΰ": "y", "φ": "f", "χ": "ch",
    "ψ": "ps", "ω": "o", "ώ": "o"
  };
  // a name for a file in a web address: ASCII letters, digits and "-"
  function slug(s, fallback) {
    var out = String(s || "").toLowerCase().replace(/ο[υύ]/g, "ou").replace(/α[υύ]/g, "av").replace(/ε[υύ]/g, "ev").replace(/[α-ωάέήίόύώϊϋΐΰς]/g, function (c) { return GREEK[c] || ""; });
    if (out.normalize) out = out.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
    return out || fallback || "episode";
  }
  // the episode's file name, once: "<n>-<title>" (n padded to 3), a free one in `taken`
  function epSlug(ep, title, taken) {
    var base = (ep.type === "full" && ep.n ? ("00" + ep.n).slice(-3) + "-" : ep.type !== "full" ? ep.type + "-" : "") + slug(title, "episode");
    base = base.slice(0, 55).replace(/-+$/, "");
    var s = base, k = 2;
    while (taken && taken[s]) s = base + "-" + (k++);
    return s;
  }
  function showDir(showId) { return DIR + "/" + showId; }
  function epPath(showId, sl) { return showDir(showId) + "/" + sl + ".mp3"; }
  function coverPath(showId, ext) { return showDir(showId) + "/cover." + (ext === "png" ? "png" : "jpg"); }

  // ---------- 4. UUIDv5 (RFC 9562) over SHA-1 ----------
  function utf8(s) {
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function sha1(bytes) {
    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var msg = bytes.slice(), bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (var s = 7; s >= 0; s--) msg.push(s >= 4 ? 0 : (bitLen >>> (s * 8)) & 255);
    var w = new Array(80);
    for (var off = 0; off < msg.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    var out = [];
    [h0, h1, h2, h3, h4].forEach(function (v) { out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); });
    return out;
  }
  function uuidV5(ns, name) {
    var nsBytes = ns.replace(/-/g, "").match(/../g).map(function (h) { return parseInt(h, 16); });
    var hb = sha1(nsBytes.concat(utf8(name))).slice(0, 16);
    hb[6] = (hb[6] & 0x0f) | 0x50;
    hb[8] = (hb[8] & 0x3f) | 0x80;
    var hex = hb.map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }
  // podcast:guid: UUIDv5 of the feed's address without the scheme and the trailing slashes
  function feedGuid(feedUrl) { return uuidV5(NS_PODCAST, String(feedUrl).replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "")); }
  // an episode's guid: from the show and the project only, so it is the same on every device and never changes
  function epGuid(showId, projectId) { return uuidV5(NS_PODCAST, "orOS Studio episode " + showId + "/" + projectId); }
  function feedUrl(show) { return show.url ? show.url + "feed.xml" : ""; }

  // ---------- 5. What is missing before a site can be made ----------
  // → list of codes (empty = ready): title, author, desc, url, cover, eps
  function problems(show, eps) {
    var out = [];
    if (!show.title) out.push("title");
    if (!show.author) out.push("author");
    if (!show.desc) out.push("desc");
    if (!show.url) out.push("url");
    if (!show.cover) out.push("cover");
    if (!(eps || []).some(function (e) { return !!e.ep.file; })) out.push("eps");
    return out;
  }
  // a square picture of 1400–3000 px (Apple Podcasts)
  function coverOk(w, h) { return isInt(w) && w === h && w >= 1400 && w <= 3000; }

  // ---------- 6. The feed ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1");
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function rfc822(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return DAYS[d.getUTCDay()] + ", " + p(d.getUTCDate()) + " " + MONS[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " +
      p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " +0000";
  }
  function isoDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function coverName(show) { return show.cover ? "cover." + (/\.png$/.test(show.cover) ? "png" : "jpg") : ""; }
  // the site's files, relative to show.url
  function files(show, eps) {
    var out = { feed: "feed.xml", page: "index.html", style: "style.css", cover: coverName(show), eps: [] };
    eps.forEach(function (e) {
      if (!e.ep.file) return;
      out.eps.push({ pid: e.p.id, audio: "episodes/" + e.ep.slug + ".mp3", chapters: chapters(e.mk, e.ep.dur).length ? "chapters/" + e.ep.slug + ".json" : "" });
    });
    return out;
  }
  function epTitle(e, untitled) { return e.ep.title || line(e.p.name, LIM.title) || untitled || "Episode"; }
  // opts: { now (ms), untitled, intro, generator }
  function feedXml(show, eps, opts) {
    opts = opts || {};
    var ready = eps.filter(function (e) { return !!e.ep.file; });
    var f = files(show, ready), base = show.url, x = [];
    var tag = function (name, value, attrs) {
      x.push("    <" + name + (attrs || "") + ">" + esc(value) + "</" + name + ">");
    };
    x.push('<?xml version="1.0" encoding="UTF-8"?>');
    x.push('<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    x.push("  <channel>");
    tag("title", show.title);
    tag("link", base);
    x.push('    <atom:link href="' + esc(base + f.feed) + '" rel="self" type="application/rss+xml"/>');
    tag("language", show.lang);
    tag("description", show.desc);
    tag("itunes:author", show.author);
    if (f.cover) {
      x.push('    <itunes:image href="' + esc(base + f.cover) + '"/>');
      x.push("    <image>");
      x.push("      <url>" + esc(base + f.cover) + "</url>");
      x.push("      <title>" + esc(show.title) + "</title>");
      x.push("      <link>" + esc(base) + "</link>");
      x.push("    </image>");
    }
    if (show.cat) {
      if (show.sub) {
        x.push('    <itunes:category text="' + esc(show.cat) + '">');
        x.push('      <itunes:category text="' + esc(show.sub) + '"/>');
        x.push("    </itunes:category>");
      } else x.push('    <itunes:category text="' + esc(show.cat) + '"/>');
    }
    tag("itunes:explicit", show.explicit ? "true" : "false");
    tag("itunes:type", show.type);
    if (show.email) {
      x.push("    <itunes:owner>");
      x.push("      <itunes:name>" + esc(show.author) + "</itunes:name>");
      x.push("      <itunes:email>" + esc(show.email) + "</itunes:email>");
      x.push("    </itunes:owner>");
      tag("podcast:locked", "yes", ' owner="' + esc(show.email) + '"');
    } else tag("podcast:locked", "no");
    if (show.guid) tag("podcast:guid", show.guid);
    if (show.fund) tag("podcast:funding", opts.fundLabel || "Support", ' url="' + esc(show.fund) + '"');
    tag("generator", opts.generator || "orOS Studio");
    if (opts.now) tag("lastBuildDate", rfc822(opts.now));
    ready.forEach(function (e, i) {
      var ep = e.ep, fe = f.eps[i];
      x.push("    <item>");
      x.push("      <title>" + esc(epTitle(e, opts.untitled)) + "</title>");
      if (ep.desc) x.push("      <description>" + esc(ep.desc) + "</description>");
      x.push('      <enclosure url="' + esc(base + fe.audio) + '" length="' + ep.bytes + '" type="audio/mpeg"/>');
      x.push('      <guid isPermaLink="false">' + esc(ep.guid) + "</guid>");
      x.push("      <pubDate>" + rfc822(ep.date) + "</pubDate>");
      x.push("      <link>" + esc(base + "#" + ep.slug) + "</link>");
      x.push("      <itunes:duration>" + Math.round(ep.dur) + "</itunes:duration>");
      x.push("      <itunes:episodeType>" + ep.type + "</itunes:episodeType>");
      if (ep.n) x.push("      <itunes:episode>" + ep.n + "</itunes:episode>");
      if (ep.se) x.push("      <itunes:season>" + ep.se + "</itunes:season>");
      x.push("      <itunes:explicit>" + (ep.explicit ? "true" : "false") + "</itunes:explicit>");
      if (fe.chapters) x.push('      <podcast:chapters url="' + esc(base + fe.chapters) + '" type="application/json+chapters"/>');
      x.push("    </item>");
    });
    x.push("  </channel>");
    x.push("</rss>");
    return x.join("\n") + "\n";
  }

  // ---------- 7. The show's web page (no JavaScript, nothing from outside) ----------
  var PAGE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'";
  function fmtDur(sec) {
    var s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h ? h + ":" + p(m) + ":" + p(r) : m + ":" + p(r);
  }
  function paras(s) {
    return s.split(/\n{2,}/).map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("\n");
  }
  // words: { subscribe, feed, episode, season, trailer, bonus, support, untitled, credit }
  function pageHtml(show, eps, words) {
    words = words || {};
    var ready = eps.filter(function (e) { return !!e.ep.file; }), f = files(show, ready), x = [];
    x.push("<!doctype html>");
    x.push('<html lang="' + esc(show.lang) + '">');
    x.push("<head>");
    x.push('<meta charset="utf-8">');
    x.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    x.push('<meta http-equiv="Content-Security-Policy" content="' + PAGE_CSP + '">');
    x.push("<title>" + esc(show.title) + "</title>");
    x.push('<meta name="description" content="' + esc(show.desc.replace(/\s+/g, " ").slice(0, 160)) + '">');
    x.push('<link rel="alternate" type="application/rss+xml" title="' + esc(show.title) + '" href="' + f.feed + '">');
    x.push('<link rel="stylesheet" href="' + f.style + '">');
    x.push("</head>");
    x.push("<body>");
    x.push("<header>");
    if (f.cover) x.push('<img class="cover" src="' + f.cover + '" alt="" width="240" height="240">');
    x.push("<div>");
    x.push("<h1>" + esc(show.title) + "</h1>");
    x.push('<p class="by">' + esc(show.author) + "</p>");
    x.push('<p class="links"><a href="' + f.feed + '">' + esc(words.feed || "RSS feed") + "</a>" +
      (show.fund ? ' · <a href="' + esc(show.fund) + '" rel="noopener">' + esc(words.support || "Support") + "</a>" : "") + "</p>");
    x.push("</div>");
    x.push("</header>");
    x.push("<main>");
    x.push(paras(show.desc));
    ready.forEach(function (e, i) {
      var ep = e.ep, fe = f.eps[i];
      var kind = ep.type === "trailer" ? (words.trailer || "Trailer") : ep.type === "bonus" ? (words.bonus || "Bonus") :
        ep.n ? (ep.se ? (words.season || "Season") + " " + ep.se + " · " : "") + (words.episode || "Episode") + " " + ep.n : "";
      x.push('<article id="' + ep.slug + '">');
      x.push("<h2>" + esc(epTitle(e, words.untitled)) + "</h2>");
      x.push('<p class="meta">' + esc([kind, isoDate(ep.date), fmtDur(ep.dur)].filter(Boolean).join(" · ")) + "</p>");
      x.push('<audio controls preload="none" src="' + fe.audio + '"></audio>');
      if (ep.desc) x.push(paras(ep.desc));
      x.push("</article>");
    });
    x.push("</main>");
    x.push('<footer><p>' + esc(words.credit || "Made with orOS Studio") + "</p></footer>");
    x.push("</body>");
    x.push("</html>");
    return x.join("\n") + "\n";
  }
  var PAGE_CSS = [
    ":root { color-scheme: light dark; --fg: #1d1d22; --bg: #fafafa; --mute: #666; --line: #ddd; --acc: #6d4aff; }",
    "@media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --bg: #16161a; --mute: #a0a0aa; --line: #333; --acc: #a996ff; } }",
    "* { box-sizing: border-box; }",
    "body { margin: 0 auto; max-width: 760px; padding: 24px 16px 48px; font: 16px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); }",
    "header { display: flex; gap: 20px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }",
    ".cover { width: 160px; height: 160px; border-radius: 12px; object-fit: cover; }",
    "h1 { margin: 0 0 4px; font-size: 1.8rem; line-height: 1.2; }",
    "h2 { margin: 0 0 4px; font-size: 1.2rem; }",
    ".by, .meta { margin: 0; color: var(--mute); }",
    ".links a, a { color: var(--acc); }",
    "article { border-top: 1px solid var(--line); padding: 16px 0; }",
    "audio { width: 100%; margin: 8px 0; }",
    "footer { margin-top: 32px; color: var(--mute); font-size: .85rem; }"
  ].join("\n") + "\n";

  // ---------- 8. ID3 tags for an episode (StudioEncode.id3v24, wave A1b) ----------
  function id3Tags(show, e, opts) {
    opts = opts || {};
    var ep = e.ep, chs = chapters(e.mk, opts.dur || ep.dur, opts.intro);
    var tags = {
      title: epTitle(e, opts.untitled),
      artist: show.author,
      album: show.title,
      genre: "Podcast",
      date: ep.date ? isoDate(ep.date) : "",
      lang: opts.lang3 || "",
      length: Math.round((opts.dur || ep.dur) * 1000),
      comment: ep.desc ? ep.desc.slice(0, 1000) : "",
      tool: opts.tool || "orOS Studio"
    };
    if (ep.n) tags.track = String(ep.n);
    if (show.url && ep.slug) tags.url = show.url + "#" + ep.slug;
    if (opts.cover && opts.cover.bytes) tags.cover = opts.cover;
    if (chs.length) {
      tags.chapters = chs.map(function (c, i) {
        return { id: "ch" + i, start: Math.round(c.start * 1000), end: Math.round(c.end * 1000), title: c.title || String(i + 1) };
      });
    }
    Object.keys(tags).forEach(function (k) { if (tags[k] === "") delete tags[k]; });
    return tags;
  }

  // ---------- 9. ZIP of the site (stored, built from parts) ----------
  var CRC_T = null;
  function crcTable() {
    if (CRC_T) return CRC_T;
    CRC_T = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c;
    }
    return CRC_T;
  }
  // running CRC-32: crc = crc32(chunk, crc) per chunk, from crc32(first)
  function crc32(bytes, prev) {
    var T = crcTable(), c = prev === undefined ? -1 : ~prev;
    for (var i = 0; i < bytes.length; i++) c = T[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (~c) >>> 0;
  }
  // entries: [{ name, size, crc }] (names in ASCII) → [Uint8Array | index]:
  // the ZIP is these parts in order, a number standing for that entry's own
  // bytes (a Blob or the text), so a large episode is never copied in memory.
  function zipParts(entries, date) {
    var d = date instanceof Date ? date : new Date(Date.UTC(2026, 0, 1));
    var dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosD = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    if (entries.length > 65535) throw new Error("zip");
    var parts = [], central = [], off = 0;
    var head = function (sig, len) { var v = new DataView(new ArrayBuffer(len)); v.setUint32(0, sig, true); return v; };
    entries.forEach(function (f, i) {
      if (!/^[A-Za-z0-9._-]{1,80}(\/[A-Za-z0-9._-]{1,80}){0,3}$/.test(f.name) || /(^|\/)\.\.?(\/|$)/.test(f.name) || !isInt(f.size) || f.size < 0) throw new Error("zip");
      var name = new Uint8Array(utf8(f.name));
      if (off + 30 + name.length + f.size > 0xfffffff0) throw new Error("zip-big");
      var h = head(0x04034b50, 30);
      h.setUint16(4, 20, true); h.setUint16(6, 0, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
      h.setUint32(14, f.crc >>> 0, true); h.setUint32(18, f.size, true); h.setUint32(22, f.size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, i);
      var c = head(0x02014b50, 46);
      c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
      c.setUint32(16, f.crc >>> 0, true); c.setUint32(20, f.size, true); c.setUint32(24, f.size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + f.size;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var e = head(0x06054b50, 22);
    e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return parts.concat(central, [new Uint8Array(e.buffer)]);
  }
  function textBytes(s) { return new Uint8Array(utf8(s)); }

  var api = {
    LIM: LIM, CATS: CATS, KBPS: KBPS, EP_TYPES: EP_TYPES, TYPES: TYPES, DIR: DIR, NS_PODCAST: NS_PODCAST, PAGE_CSS: PAGE_CSS, PAGE_CSP: PAGE_CSP,
    normShow: normShow, normEp: normEp, normMarkers: normMarkers, shows: shows, findShow: findShow,
    episodes: episodes, nextEpNo: nextEpNo,
    addMarker: addMarker, setMarker: setMarker, removeMarker: removeMarker, chapters: chapters, chaptersJson: chaptersJson, markerHash: markerHash, stale: stale,
    slug: slug, epSlug: epSlug, showDir: showDir, epPath: epPath, coverPath: coverPath,
    sha1: sha1, uuidV5: uuidV5, feedGuid: feedGuid, epGuid: epGuid, feedUrl: feedUrl, siteUrl: siteUrl,
    problems: problems, coverOk: coverOk, files: files, feedXml: feedXml, rfc822: rfc822, pageHtml: pageHtml, fmtDur: fmtDur,
    id3Tags: id3Tags, crc32: crc32, zipParts: zipParts, textBytes: textBytes, utf8: utf8
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioPodcast = api;
})(typeof window !== "undefined" ? window : this);
