// ============================================================
// orOS Podcasts — core.js (pure logic, v1.0.0)
// Everything that is not the screen, the audio element or the
// network: ids, the podcast parts of a feed (itunes: / podcast:
// tags) read from a small element tree, durations, chapters,
// catalog search results, the data model and its merge (sync slice
// "podcasts"), the queue and the "when to sync the position" rule.
// No DOM, no storage, no fetch. Node tests load it as is (it
// attaches OrosPodcastsCore to its global).
//
// Feed transport, safe XML parsing, OPML, discovery and the HTML
// sanitizer belong to the Reader app (feeds/, shared read-only).
// This file only reads the parsed document, through fromDom() or
// any tree of the same shape:
//   node = { ns: "namespace uri" | "", ln: "localName",
//            a: { attrName: value }, c: [child nodes], t: "text" }
//
// Sections:
//   1. Constants
//   2. Text + numbers
//   3. URLs + ids
//   4. Element tree
//   5. Feed: show + episodes
//   6. Durations, timestamps, chapters
//   7. Catalog search (Apple, fyyd)
//   8. Normalize
//   9. Merge (R5, R17, R26)
//  10. Mutations (stamp at the mutation site, R27)
//  11. Queue
//  12. Position sync throttle
//  13. Views
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants ----------
  var DATA_VER = 1;
  var SHOW_RE = /^s[0-9a-z]{12,14}$/;
  var EP_RE = /^e[0-9a-z]{12,14}$/;
  var LIM = {
    title: 200, by: 120, url: 2000, desc: 20000, shows: 500, eps: 4000, queue: 300,
    played: 0.95, skipMax: 600, spdMin: 0.5, spdMax: 3, autoMax: 10, chapters: 500
  };
  var SPEEDS = [0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.75, 1.8, 2, 2.25, 2.5, 2.75, 3];
  var DAY = 86400000;
  var SYNC_EVERY = 300;        // s of continuous listening between position syncs
  var SYNC_MIN_MOVE = 10;      // s: smaller moves never dirty the slice
  var FLOOR_AGE = 30 * DAY;    // the "all older are played" floor never covers the last 30 days

  var NS = {
    itunes: ["http://www.itunes.com/dtds/podcast-1.0.dtd"],
    podcast: ["https://podcastindex.org/namespace/1.0", "http://podcastindex.org/namespace/1.0",
      "https://github.com/podcastindex-org/podcast-namespace/blob/main/docs/1.0.md"],
    content: ["http://purl.org/rss/1.0/modules/content/"],
    atom: ["http://www.w3.org/2005/atom"],
    media: ["http://search.yahoo.com/mrss/", "http://search.yahoo.com/mrss"],
    dc: ["http://purl.org/dc/elements/1.1/"]
  };
  // Prefixes some broken feeds use without declaring the namespace.
  var PREFIX = { itunes: "itunes", podcast: "podcast", content: "content", atom: "atom", media: "media", dc: "dc" };

  // ---------- 2. Text + numbers ----------
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  // One line: control chars out, whitespace collapsed, clipped.
  function clean(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f\u200b\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim();
    return max && s.length > max ? s.slice(0, max).trim() : s;
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ς/g, "σ");
  }
  // Text out of HTML-ish show notes for the list preview and search
  // (never rendered as HTML; the notes view uses the sanitizer).
  function plain(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n")
      .replace(/<[^>]*>/g, " ");
    s = decodeEntities(s).replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return max && s.length > max ? s.slice(0, max).trim() + "…" : s;
  }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", hellip: "…", mdash: "—", ndash: "–",
    laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : "";
      }
      var k = e.toLowerCase();
      return ENT.hasOwnProperty(k) ? ENT[k] : m;
    });
  }

  // ---------- 3. URLs + ids ----------
  // Only http(s), no credentials, no fragments, length-bounded.
  function safeUrl(u, base) {
    if (typeof u !== "string") return "";
    u = u.trim();
    if (!u || u.length > LIM.url) return "";
    var x;
    try { x = base ? new URL(u, base) : new URL(u); } catch (e) { return ""; }
    if (x.protocol !== "https:" && x.protocol !== "http:") return "";
    if (x.username || x.password) return "";
    x.hash = "";
    return x.href;
  }
  // The key that makes "the same feed" on two devices the same id:
  // lower-case host, no default port, no trailing slash, http and
  // https alike, "feed://"/"pcast://"/"itpc://" understood.
  function feedKey(u) {
    if (typeof u !== "string") return "";
    u = u.trim().replace(/^(feed|pcast|itpc|podcast):\/\//i, "https://").replace(/^(feed|pcast|itpc):/i, "");
    var s = safeUrl(u);
    if (!s) return "";
    var x = new URL(s);
    var path = x.pathname.replace(/\/+$/, "") || "";
    return x.host.toLowerCase().replace(/^www\./, "") + path + x.search;
  }
  // FNV-1a, two 32-bit lanes → 13 base-36 chars (collisions are not
  // a security matter here: ids are only keys in the user's own data).
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function hash13(s) {
    var a = fnv(s, 2166136261), b = fnv(s, 3323198485);
    var hi = a.toString(36), lo = b.toString(36);
    return ("0000000" + hi).slice(-7) + ("000000" + lo).slice(-6);
  }
  function showId(url) { var k = feedKey(url); return k ? "s" + hash13(k) : ""; }
  // Episode identity: the feed's guid, else the enclosure URL, else
  // title + date. Scoped by show so two shows never share an id.
  function episodeId(sid, ep) {
    var key = (ep && (ep.guid || ep.audio || (ep.title + "|" + ep.pub))) || "";
    return sid && key ? "e" + hash13(sid + "|" + key) : "";
  }
  // podcasts.apple.com/…/id123456 (and itunes.apple.com) → "123456".
  function appleId(u) {
    var s = safeUrl(u);
    if (!s) return "";
    var x = new URL(s);
    if (!/(^|\.)(podcasts|itunes)\.apple\.com$/i.test(x.hostname)) return "";
    var m = x.pathname.match(/\/id(\d{3,15})(?:\/|$)/) || (x.searchParams.get("id") || "").match(/^(\d{3,15})$/);
    return m ? m[1] : "";
  }
  function appleLookupUrl(id) {
    return /^\d{3,15}$/.test(String(id)) ? "https://itunes.apple.com/lookup?entity=podcast&id=" + id : "";
  }

  // ---------- 4. Element tree ----------
  // DOM (from DOMParser in the browser) → plain tree. Elements only;
  // text is the concatenated text/CDATA of the element's own children.
  function fromDom(el, depth) {
    depth = depth || 0;
    if (!el || el.nodeType !== 1 || depth > 12) return null;
    var node = { ns: (el.namespaceURI || "").toLowerCase(), ln: el.localName || "", a: {}, c: [], t: "" };
    var p = el.prefix || "";
    if (p) node.p = p.toLowerCase();
    var at = el.attributes || [];
    for (var i = 0; i < at.length; i++) node.a[at[i].localName || at[i].name] = at[i].value;
    var t = "";
    for (var k = el.firstChild; k; k = k.nextSibling) {
      if (k.nodeType === 1) { var c = fromDom(k, depth + 1); if (c) node.c.push(c); }
      else if (k.nodeType === 3 || k.nodeType === 4) t += k.nodeValue;
    }
    node.t = t;
    return node;
  }
  function inNs(node, ns) {
    if (!ns) return !node.ns || node.ns === "http://backend.userland.com/rss2";
    if (NS[ns].indexOf(node.ns) >= 0) return true;
    // Undeclared or misspelt namespace: fall back to the usual prefix.
    if (node.p === PREFIX[ns]) return true;
    return ns === "itunes" && /itunes\.com\/dtds\/podcast/i.test(node.ns);
  }
  function kids(node, ns, ln) {
    var out = [];
    if (!node || !node.c) return out;
    for (var i = 0; i < node.c.length; i++) {
      var c = node.c[i];
      if (c.ln === ln && inNs(c, ns)) out.push(c);
    }
    return out;
  }
  function kid(node, ns, ln) { return kids(node, ns, ln)[0] || null; }
  function txt(node, ns, ln, max) { var k = kid(node, ns, ln); return k ? clean(k.t, max) : ""; }
  // RSS text, else the same element in the Atom namespace.
  function txtA(node, ln, max) { return txt(node, "", ln, max) || txt(node, "atom", ln, max); }
  function attr(node, name) { return node && node.a && typeof node.a[name] === "string" ? node.a[name].trim() : ""; }

  // ---------- 5. Feed: show + episodes ----------
  function parseDate(s) {
    s = clean(s, 80);
    if (!s) return 0;
    var t = Date.parse(s);
    if (isNaN(t)) {
      // RFC 822 variants Date.parse rejects: Greek day names, "UT",
      // missing day name, two-digit years.
      var m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([+-]\d{4}|[A-Z]{1,4})?/);
      if (!m) return 0;
      var y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
      var tz = m[7] || "GMT";
      if (tz === "UT" || tz === "Z") tz = "GMT";
      t = Date.parse(m[1] + " " + m[2] + " " + y + " " + (m[4] || "0") + ":" + (m[5] || "00") + ":" + (m[6] || "00") + " " + tz);
      if (isNaN(t)) return 0;
    }
    return t > 0 ? t : 0;
  }
  function imageOf(node, base) {
    var im = kid(node, "itunes", "image");
    var u = im ? safeUrl(attr(im, "href") || clean(im.t), base) : "";
    if (!u) { var ri = kid(node, "", "image"); if (ri) u = safeUrl(txt(ri, "", "url"), base); }
    if (!u) {
      var mt = kid(node, "media", "thumbnail");
      if (mt) u = safeUrl(attr(mt, "url"), base);
    }
    return u;
  }
  function audioOf(item, base) {
    var encs = kids(item, "", "enclosure");
    var best = null;
    encs.forEach(function (e) {
      var u = safeUrl(attr(e, "url"), base);
      if (!u) return;
      var ty = clean(attr(e, "type"), 80).toLowerCase();
      var isAv = /^(audio|video)\//.test(ty) || (!ty && /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|mov|webm)(\?|$)/i.test(u));
      if (!isAv) return;
      var len = parseInt(attr(e, "length"), 10);
      var cand = { url: u, type: ty, size: isFinite(len) && len > 0 ? len : 0, video: /^video\//.test(ty) };
      // Prefer audio over video, then the first one.
      if (!best || (best.video && !cand.video)) best = cand;
    });
    if (!best) {
      // Atom: <link rel="enclosure">; Media RSS: <media:content>.
      kids(item, "atom", "link").concat(kids(item, "", "link")).forEach(function (l) {
        if (best || attr(l, "rel") !== "enclosure") return;
        var u = safeUrl(attr(l, "href"), base);
        if (u) best = { url: u, type: clean(attr(l, "type"), 80).toLowerCase(), size: +attr(l, "length") || 0, video: /^video\//.test(attr(l, "type")) };
      });
    }
    if (!best) {
      kids(item, "media", "content").forEach(function (mc) {
        if (best) return;
        var u = safeUrl(attr(mc, "url"), base), ty = clean(attr(mc, "type"), 80).toLowerCase();
        if (u && /^(audio|video)\//.test(ty)) best = { url: u, type: ty, size: +attr(mc, "fileSize") || 0, video: /^video\//.test(ty) };
      });
    }
    return best;
  }
  function parseShow(channel, feedUrl) {
    if (!channel) return null;
    var base = safeUrl(feedUrl) || undefined;
    var newUrl = "";
    var nf = kid(channel, "itunes", "new-feed-url");
    if (nf) newUrl = safeUrl(clean(nf.t), base);
    var cats = [];
    kids(channel, "itunes", "category").forEach(function (c) {
      var t = clean(attr(c, "text"), 60);
      if (t && cats.indexOf(t) < 0) cats.push(t);
      kids(c, "itunes", "category").forEach(function (s) {
        var st = clean(attr(s, "text"), 60);
        if (st && cats.indexOf(st) < 0) cats.push(st);
      });
    });
    var funding = [];
    kids(channel, "podcast", "funding").forEach(function (f) {
      var u = safeUrl(attr(f, "url"), base);
      if (u) funding.push({ url: u, label: clean(f.t, 80) });
    });
    return {
      title: txtA(channel, "title", LIM.title) || txt(channel, "itunes", "title", LIM.title),
      by: txt(channel, "itunes", "author", LIM.by) || txt(channel, "dc", "creator", LIM.by) || txt(channel, "", "managingEditor", LIM.by),
      img: imageOf(channel, base),
      link: safeUrl(txt(channel, "", "link"), base),
      desc: (kid(channel, "", "description") || kid(channel, "itunes", "summary") || { t: "" }).t.slice(0, LIM.desc),
      lang: txt(channel, "", "language", 20).toLowerCase(),
      cats: cats.slice(0, 6),
      explicit: /^(yes|true|explicit)$/i.test(txt(channel, "itunes", "explicit")),
      serial: /^serial$/i.test(txt(channel, "itunes", "type")),
      newUrl: newUrl && feedKey(newUrl) !== feedKey(feedUrl || "") ? newUrl : "",
      funding: funding.slice(0, 3),
      complete: /^yes$/i.test(txt(channel, "itunes", "complete"))
    };
  }
  function parseEpisode(item, feedUrl, sid, showImg) {
    var base = safeUrl(feedUrl) || undefined;
    var audio = audioOf(item, base);
    if (!audio) return null;
    var ep = {
      guid: txt(item, "", "guid", 500) || txt(item, "atom", "id", 500),
      title: txtA(item, "title", LIM.title) || txt(item, "itunes", "title", LIM.title),
      pub: parseDate(txt(item, "", "pubDate") || txt(item, "dc", "date") || txt(item, "atom", "published") || txt(item, "atom", "updated")),
      audio: audio.url, type: audio.type, size: audio.size, video: audio.video,
      dur: parseDuration(txt(item, "itunes", "duration")),
      img: imageOf(item, base) || showImg || "",
      link: safeUrl(txt(item, "", "link"), base),
      season: posInt(txt(item, "itunes", "season") || txt(item, "podcast", "season")),
      num: posInt(txt(item, "itunes", "episode")),
      kind: (txt(item, "itunes", "episodeType").toLowerCase().match(/^(full|trailer|bonus)$/) || ["full"])[0],
      explicit: /^(yes|true|explicit)$/i.test(txt(item, "itunes", "explicit")),
      notes: ((kid(item, "content", "encoded") || kid(item, "", "description") || kid(item, "itunes", "summary") ||
        kid(item, "atom", "content") || kid(item, "atom", "summary") || { t: "" }).t).slice(0, LIM.desc),
      chapters: "", transcripts: []
    };
    if (!ep.title) ep.title = ep.pub ? new Date(ep.pub).toISOString().slice(0, 10) : "—";
    var ch = kid(item, "podcast", "chapters");
    if (ch && /json/i.test(attr(ch, "type") || "json")) ep.chapters = safeUrl(attr(ch, "url"), base);
    kids(item, "podcast", "transcript").forEach(function (tr) {
      var u = safeUrl(attr(tr, "url"), base), ty = clean(attr(tr, "type"), 60).toLowerCase();
      if (u && ep.transcripts.length < 4) ep.transcripts.push({ url: u, type: ty, lang: clean(attr(tr, "language"), 20) });
    });
    ep.id = episodeId(sid, ep);
    return ep.id ? ep : null;
  }
  // root = the tree of the whole document (<rss> or Atom <feed>).
  function parseFeed(rootNode, feedUrl) {
    if (!rootNode) return null;
    var channel = rootNode.ln === "rss" ? kid(rootNode, "", "channel") : rootNode.ln === "feed" ? rootNode : null;
    if (!channel && rootNode.ln === "channel") channel = rootNode;
    if (!channel) return null;
    var sid = showId(feedUrl);
    var show = parseShow(channel, feedUrl);
    if (!show) return null;
    var items = rootNode.ln === "feed" ? kids(channel, "atom", "entry").concat(kids(channel, "", "entry")) : kids(channel, "", "item");
    var seen = {}, eps = [];
    items.forEach(function (it) {
      var ep = parseEpisode(it, feedUrl, sid, show.img);
      if (!ep || seen[ep.id]) return;
      seen[ep.id] = 1;
      eps.push(ep);
    });
    eps.sort(function (x, y) { return (y.pub - x.pub) || cmpStr(x.id, y.id); });
    show.id = sid;
    show.url = safeUrl(feedUrl);
    return { show: show, eps: eps };
  }

  // ---------- 6. Durations, timestamps, chapters ----------
  function posInt(s) { var n = parseInt(String(s || "").trim(), 10); return isFinite(n) && n > 0 && n < 1e6 ? n : 0; }
  // itunes:duration: "3723", "3723.4", "62:03", "1:02:03", "01:02:03.5"
  // (and the odd "1h 2m 3s"). Whole seconds, 0 = unknown.
  function parseDuration(s) {
    s = clean(String(s == null ? "" : s), 40);
    if (!s) return 0;
    var m;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
    if ((m = s.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d(?:\.\d+)?))?$/))) {
      return m[3] !== undefined ? Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]) : +m[1] * 60 + +m[2];
    }
    if ((m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/i)) && (m[1] || m[2] || m[3])) {
      return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }
    return 0;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(+sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  // Timestamps written in show notes ("12:34", "1:02:03") → seconds,
  // in order, deduped, only inside the episode's length when known.
  function noteStamps(text, dur) {
    var out = [], seen = {};
    String(text || "").replace(/(^|[\s(\[,;\u2013\u2014-])((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/g, function (m, pre, ts) {
      var v = parseDuration(ts);
      if (!seen[v] && (!dur || v <= dur)) { seen[v] = 1; out.push({ at: v, text: ts }); }
      return m;
    });
    return out;
  }
  // Podcasting 2.0 JSON chapters → [{at, title, img, url}] sorted.
  function normChapters(json, base) {
    var list = json && Array.isArray(json.chapters) ? json.chapters : [];
    var out = [];
    list.forEach(function (c) {
      if (!c || typeof c !== "object" || out.length >= LIM.chapters) return;
      var at = +c.startTime;
      if (!isFinite(at) || at < 0) return;
      if (c.toc === false) return;
      out.push({ at: Math.floor(at), title: clean(c.title, 200) || fmtTime(at), img: safeUrl(c.img, base), url: safeUrl(c.url, base) });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }
  function chapterAt(chs, pos) {
    var cur = null;
    for (var i = 0; i < (chs || []).length; i++) { if (chs[i].at <= pos) cur = chs[i]; else break; }
    return cur;
  }

  // ---------- 7. Catalog search (Apple, fyyd) ----------
  function appleSearchUrl(term, country) {
    term = clean(term, 100);
    if (!term) return "";
    var cc = /^[a-z]{2}$/.test(country || "") ? "&country=" + country : "";
    return "https://itunes.apple.com/search?media=podcast&entity=podcast&limit=30" + cc + "&term=" + encodeURIComponent(term);
  }
  function fyydSearchUrl(term) {
    term = clean(term, 100);
    return term ? "https://api.fyyd.de/0.2/search/podcast?count=30&title=" + encodeURIComponent(term) : "";
  }
  function hit(url, title, by, img, genre, count, src) {
    var u = safeUrl(url);
    if (!u) return null;
    return { url: u, id: showId(u), title: clean(title, LIM.title) || u, by: clean(by, LIM.by), img: safeUrl(img),
      genre: clean(genre, 60), count: isInt(+count) && +count > 0 ? +count : 0, src: src };
  }
  function parseAppleResults(json) {
    var out = [];
    (json && Array.isArray(json.results) ? json.results : []).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var h = hit(r.feedUrl, r.collectionName || r.trackName, r.artistName, r.artworkUrl600 || r.artworkUrl100,
        r.primaryGenreName, r.trackCount, "apple");
      if (h) out.push(h);
    });
    return out;
  }
  function parseFyydResults(json) {
    var out = [];
    (json && Array.isArray(json.data) ? json.data : []).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var h = hit(r.xmlURL, r.title, r.author, r.imgURL || r.layoutImageURL, (r.categories && r.categories[0] && r.categories[0].name) || "",
        r.episode_count, "fyyd");
      if (h) out.push(h);
    });
    return out;
  }
  // Apple first, fyyd fills in; one row per feed.
  function mergeResults(lists) {
    var seen = {}, out = [];
    (lists || []).forEach(function (l) {
      (l || []).forEach(function (h) { if (h && h.id && !seen[h.id]) { seen[h.id] = 1; out.push(h); } });
    });
    return out;
  }

  // ---------- 8. Normalize ----------
  function isStamp(n) { return isInt(n) && n >= 0; }
  function normSpd(n) { n = +n; return isFinite(n) && n >= LIM.spdMin && n <= LIM.spdMax ? Math.round(n * 100) / 100 : 0; }
  function normShow(s) {
    if (!s || typeof s !== "object" || !SHOW_RE.test(s.id) || !isStamp(s.m)) return null;
    var url = safeUrl(s.url);
    if (!url || showId(url) !== s.id) return null;
    var x = { id: s.id, m: s.m, url: url, title: clean(s.title, LIM.title) || url, by: clean(s.by, LIM.by), img: safeUrl(s.img) };
    // Per-show settings: 0 = use the global default.
    x.spd = normSpd(s.spd);
    x.skA = isInt(s.skA) ? clamp(s.skA, 0, LIM.skipMax) : 0;
    x.skB = isInt(s.skB) ? clamp(s.skB, 0, LIM.skipMax) : 0;
    x.auto = isInt(s.auto) ? clamp(s.auto, 0, LIM.autoMax) : 0;
    x.ntf = s.ntf === 1 ? 1 : 0;
    x.at = isStamp(s.at) ? s.at : s.m;          // subscribed at (for "new since you subscribed")
    return x;
  }
  // Per-episode progress. p = position (s), d = duration (s, 0 = not
  // known yet), x = played, pd = publish time (ms) for the floor.
  function normEp(e) {
    if (!e || typeof e !== "object" || !EP_RE.test(e.id) || !SHOW_RE.test(e.s) || !isStamp(e.m)) return null;
    var d = isInt(e.d) && e.d > 0 && e.d < 1e6 ? e.d : 0;
    var p = isInt(e.p) && e.p > 0 ? (d ? Math.min(e.p, d) : Math.min(e.p, 1e6)) : 0;
    return { id: e.id, m: e.m, s: e.s, p: p, d: d, x: e.x === 1 ? 1 : 0, pd: isStamp(e.pd) ? e.pd : 0 };
  }
  function normQueue(q) {
    if (!q || typeof q !== "object" || !isStamp(q.m) || !Array.isArray(q.ids)) return { m: 0, ids: [] };
    var seen = {}, ids = [];
    q.ids.forEach(function (id) {
      if (typeof id === "string" && EP_RE.test(id) && !seen[id] && ids.length < LIM.queue) { seen[id] = 1; ids.push(id); }
    });
    // Queue entries carry the show so the list can be drawn offline.
    var sh = {};
    if (q.sh && typeof q.sh === "object") ids.forEach(function (id) { if (SHOW_RE.test(q.sh[id])) sh[id] = q.sh[id]; });
    return { m: q.m, ids: ids, sh: sortedObj(sh) };
  }
  var PREF_DEF = { spd: 1, back: 15, fwd: 30, autoNext: 1, delPlayed: 0, search: "both", ntf: 0 };
  function normPrefVal(k, v) {
    switch (k) {
      case "spd": return normSpd(v) || null;
      case "back": case "fwd": return isInt(v) && v >= 5 && v <= 120 ? v : null;
      case "autoNext": case "delPlayed": case "ntf": return v === 0 || v === 1 ? v : null;
      case "search": return v === "both" || v === "apple" || v === "fyyd" || v === "none" ? v : null;
    }
    return null;
  }
  // Prefs: { key: [value, mtime] }, LWW per field.
  function normPrefs(p) {
    var out = {};
    if (!p || typeof p !== "object") return out;
    Object.keys(PREF_DEF).forEach(function (k) {
      var e = p[k];
      if (!Array.isArray(e) || e.length !== 2 || !isStamp(e[1])) return;
      var v = normPrefVal(k, e[0]);
      if (v !== null) out[k] = [v, e[1]];
    });
    return out;
  }
  function prefOf(data, k) {
    var e = data && data.prefs && data.prefs[k];
    return e ? e[0] : PREF_DEF[k];
  }
  function emptyData() { return { ver: DATA_VER, shows: [], eps: [], floors: {}, queue: { m: 0, ids: [], sh: {} }, prefs: {}, tombs: {} }; }

  // ---------- 9. Merge (R5, R17, R26) ----------
  function sortedObj(o) { var r = {}; Object.keys(o).sort(cmpStr).forEach(function (k) { r[k] = o[k]; }); return r; }
  // Later m wins; equal m → larger JSON (deterministic, symmetric).
  function pick(a, b) {
    if (!a) return b; if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja >= jb ? a : b;
  }
  function mergePodcasts(A, B) {
    var a = (A && typeof A === "object") ? A : {}, b = (B && typeof B === "object") ? B : {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!SHOW_RE.test(id) || !isStamp(tm[id])) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var shows = {}, eps = {}, floors = {}, prefs = {};
    [a, b].forEach(function (s) {
      if (Array.isArray(s.shows)) s.shows.forEach(function (r) { var x = normShow(r); if (x) shows[x.id] = pick(shows[x.id], x); });
      if (Array.isArray(s.eps)) s.eps.forEach(function (r) { var x = normEp(r); if (x) eps[x.id] = pick(eps[x.id], x); });
      if (s.floors && typeof s.floors === "object") Object.keys(s.floors).forEach(function (k) {
        var v = s.floors[k];
        if (SHOW_RE.test(k) && isStamp(v) && (!(k in floors) || v > floors[k])) floors[k] = v;
      });
      var p = normPrefs(s.prefs);
      Object.keys(p).forEach(function (k) {
        var cur = prefs[k], nx = p[k];
        if (!cur || nx[1] > cur[1] || (nx[1] === cur[1] && JSON.stringify(nx[0]) > JSON.stringify(cur[0]))) prefs[k] = nx;
      });
    });
    // Delete wins ties; a newer (re)subscription resurrects.
    var live = {}, outShows = [];
    Object.keys(shows).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= shows[id].m) return;
      live[id] = 1;
      outShows.push(shows[id]);
    });
    // Progress of shows that are gone goes with them; played rows
    // under the show's floor are implied by the floor.
    var outEps = [];
    Object.keys(eps).sort(cmpStr).forEach(function (id) {
      var e = eps[id];
      if (!live[e.s]) return;
      if (e.x === 1 && e.pd && floors[e.s] && e.pd <= floors[e.s]) return;
      outEps.push(e);
    });
    var outFloors = {};
    Object.keys(floors).sort(cmpStr).forEach(function (k) { if (live[k]) outFloors[k] = floors[k]; });
    var qa = normQueue(a.queue), qb = normQueue(b.queue);
    var q = pick(qa, qb);
    // The queue never holds episodes of shows that are gone.
    if (q.ids.some(function (id) { return q.sh[id] && !live[q.sh[id]]; })) {
      var ids = q.ids.filter(function (id) { return !(q.sh[id] && !live[q.sh[id]]); }), sh = {};
      ids.forEach(function (id) { if (q.sh[id]) sh[id] = q.sh[id]; });
      q = { m: q.m, ids: ids, sh: sortedObj(sh) };
    }
    // Tombstones older than a year are dropped: no device stays
    // offline that long with a stale subscription worth killing.
    var newest = 0;
    outShows.forEach(function (s) { if (s.m > newest) newest = s.m; });
    Object.keys(tombs).forEach(function (id) { if (tombs[id] > newest) newest = tombs[id]; });
    var outTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { if (tombs[id] >= newest - 365 * DAY) outTombs[id] = tombs[id]; });
    return { ver: DATA_VER, shows: outShows, eps: outEps, floors: outFloors, queue: q, prefs: sortedObj(prefs), tombs: outTombs };
  }

  // ---------- 10. Mutations (stamp at the mutation site, R27) ----------
  // All return a NEW data object (the old one is never edited).
  function canon(d) { return mergePodcasts(d, d); }
  function findShow(data, id) {
    for (var i = 0; i < (data.shows || []).length; i++) if (data.shows[i].id === id) return data.shows[i];
    return null;
  }
  function findEp(data, id) {
    for (var i = 0; i < (data.eps || []).length; i++) if (data.eps[i].id === id) return data.eps[i];
    return null;
  }
  function subscribe(data, show, now) {
    var id = showId(show && show.url);
    if (!id) return data;
    if (findShow(data, id)) return data;
    if ((data.shows || []).length >= LIM.shows) throw new Error("limit");
    var d = JSON.parse(JSON.stringify(data));
    d.shows.push({ id: id, m: now, url: safeUrl(show.url), title: show.title, by: show.by, img: show.img, at: now });
    if (d.tombs && d.tombs[id] >= now) d.tombs[id] = now - 1;
    return canon(d);
  }
  function unsubscribe(data, id, now) {
    if (!findShow(data, id)) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.tombs[id] = now;
    return canon(d);
  }
  // Edit title/image (from a feed refresh) or per-show settings.
  // Only a real change moves m. The feed URL never changes here
  // (see moveShow).
  function editShow(data, id, patch, now) {
    var s = findShow(data, id);
    if (!s) return data;
    var x = Object.assign({}, s, patch, { id: id, m: s.m, url: s.url, at: s.at });
    var n = normShow(x);
    if (!n || JSON.stringify(n) === JSON.stringify(s)) return data;
    n.m = now;
    var d = JSON.parse(JSON.stringify(data));
    d.shows = d.shows.map(function (r) { return r.id === id ? n : r; });
    return canon(d);
  }
  // "itunes:new-feed-url": the show moves to a new id. Episode ids
  // are scoped by show, so the app passes idMap {oldEpId: newEpId}
  // built from the cached feed (same guid under the new show id);
  // progress and queue entries follow, the rest stays behind.
  function moveShow(data, oldId, url, idMap, now) {
    var s = findShow(data, oldId), nid = showId(url);
    if (!s || !nid || nid === oldId) return data;
    idMap = idMap || {};
    var d = JSON.parse(JSON.stringify(data));
    d.tombs[oldId] = now;
    if (!findShow(d, nid)) d.shows.push(Object.assign({}, s, { id: nid, url: safeUrl(url), m: now }));
    d.eps = d.eps.map(function (e) {
      if (e.s !== oldId || !EP_RE.test(idMap[e.id] || "")) return e;
      return Object.assign({}, e, { id: idMap[e.id], s: nid, m: now });
    });
    if (d.floors[oldId]) d.floors[nid] = Math.max(d.floors[nid] || 0, d.floors[oldId]);
    var ids = [], sh = {};
    d.queue.ids.forEach(function (id) {
      var nx = d.queue.sh[id] === oldId ? idMap[id] : id;
      if (!nx || ids.indexOf(nx) >= 0) return;
      ids.push(nx);
      sh[nx] = d.queue.sh[id] === oldId ? nid : d.queue.sh[id];
    });
    if (JSON.stringify(ids) !== JSON.stringify(d.queue.ids)) d.queue = { m: now, ids: ids, sh: sh };
    return canon(d);
  }
  // pos/dur in seconds; played flag optional. Returns data unchanged
  // when nothing moved (R27).
  function setProgress(data, ep, pos, dur, played, now) {
    if (!ep || !EP_RE.test(ep.id) || !SHOW_RE.test(ep.s)) return data;
    var cur = findEp(data, ep.id) || implied(data, ep);
    var d0 = isInt(dur) && dur > 0 ? dur : (cur.d || 0);
    var p = Math.max(0, Math.floor(pos || 0));
    var x = played === 1 || played === 0 ? played : cur.x;
    if (played === undefined && d0 && p >= d0 * LIM.played) x = 1;
    if (x === 1 && played === 1) p = 0;          // finished: start over next time
    var row = normEp({ id: ep.id, m: now, s: ep.s, p: p, d: d0, x: x, pd: ep.pd || cur.pd || 0 });
    if (!row) return data;
    if (cur.p === row.p && cur.d === row.d && cur.x === row.x && cur.pd === row.pd) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.eps = d.eps.filter(function (r) { return r.id !== ep.id; });
    d.eps.push(row);
    return canon(d);
  }
  // State of an episode with no row: played if under the floor.
  function implied(data, ep) {
    var f = data.floors && data.floors[ep.s];
    return { p: 0, d: 0, x: f && ep.pd && ep.pd <= f ? 1 : 0, pd: ep.pd || 0 };
  }
  function stateOf(data, ep) {
    var r = findEp(data, ep.id);
    return r ? { p: r.p, d: r.d, x: r.x } : (function (i) { return { p: 0, d: 0, x: i.x }; })(implied(data, ep));
  }
  // "Mark all as played" for a show: the floor moves to the newest
  // episode; rows with partial progress newer than now stay.
  function markAllPlayed(data, sid, eps, now) {
    var newest = 0;
    (eps || []).forEach(function (e) { if (e.pd > newest) newest = e.pd; });
    if (!newest || (data.floors[sid] || 0) >= newest) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.floors[sid] = newest;
    d.eps = d.eps.filter(function (r) { return r.s !== sid || r.pd > newest; });
    return canon(d);
  }
  // Keep the slice small: when every episode of the feed up to some
  // date older than 30 days is played, the floor moves there and those
  // rows go. Runs on the device that makes a change, never in merge.
  function compactShow(data, sid, eps, now) {
    var list = (eps || []).filter(function (e) { return e.pd > 0; }).sort(function (x, y) { return x.pd - y.pd; });
    var floor = data.floors[sid] || 0, best = floor;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.pd > now - FLOOR_AGE) break;
      if (stateOf(data, { id: e.id, s: sid, pd: e.pd }).x !== 1) break;
      best = e.pd;
    }
    if (best <= floor) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.floors[sid] = best;
    return canon(d);
  }
  function setPref(data, k, v, now) {
    var nv = normPrefVal(k, v);
    if (nv === null || prefOf(data, k) === nv && data.prefs[k]) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.prefs[k] = [nv, now];
    return canon(d);
  }

  // ---------- 11. Queue ----------
  function setQueue(data, ids, sh, now) {
    var q = normQueue({ m: now, ids: ids, sh: sh });
    if (JSON.stringify(q.ids) === JSON.stringify(data.queue.ids) && JSON.stringify(q.sh) === JSON.stringify(data.queue.sh)) return data;
    var d = JSON.parse(JSON.stringify(data));
    d.queue = q;
    return canon(d);
  }
  function queueAdd(data, ep, where, now) {
    var ids = data.queue.ids.filter(function (id) { return id !== ep.id; });
    if (where === "next") ids.unshift(ep.id); else ids.push(ep.id);
    var sh = Object.assign({}, data.queue.sh); sh[ep.id] = ep.s;
    return setQueue(data, ids, sh, now);
  }
  function queueRemove(data, id, now) {
    if (data.queue.ids.indexOf(id) < 0) return data;
    var sh = Object.assign({}, data.queue.sh); delete sh[id];
    return setQueue(data, data.queue.ids.filter(function (x) { return x !== id; }), sh, now);
  }
  function queueMove(data, id, to, now) {
    var ids = data.queue.ids.slice(), i = ids.indexOf(id);
    if (i < 0) return data;
    ids.splice(i, 1);
    ids.splice(clamp(to, 0, ids.length), 0, id);
    return setQueue(data, ids, data.queue.sh, now);
  }
  // After an episode ends: the next one in the queue (and the queue
  // without the finished one).
  function queueNext(data, finishedId) {
    var ids = data.queue.ids.filter(function (x) { return x !== finishedId; });
    return ids[0] || "";
  }

  // ---------- 12. Position sync throttle ----------
  // The position is kept locally every few seconds; the synced slice
  // only changes on these moments, so an hour of listening is ≤ ~12
  // uploads and an idle player never uploads.
  //   ev: "tick" (while playing) | "pause" | "ended" | "close" | "seek"
  //   last = { p, at } of the last commit to the slice (at in s).
  function shouldCommit(ev, pos, last, nowSec) {
    var moved = !last || Math.abs(pos - last.p) >= SYNC_MIN_MOVE;
    if (ev === "ended") return true;
    if (ev === "pause" || ev === "close") return moved;
    if (ev === "tick") return moved && (!last || nowSec - last.at >= SYNC_EVERY);
    return false;                         // "seek" alone never uploads
  }

  // ---------- 13. Views ----------
  // Newest episodes of all shows ("New" tab): not played, not started,
  // published after the subscription or the last 30 days.
  function newEpisodes(data, cache, now, max) {
    var out = [];
    (data.shows || []).forEach(function (s) {
      ((cache && cache[s.id]) || []).forEach(function (e) {
        var st = stateOf(data, { id: e.id, s: s.id, pd: e.pub });
        if (st.x || st.p) return;
        if (e.pub < Math.min(s.at, now - 30 * DAY) || e.pub > now + DAY) return;
        out.push({ show: s, ep: e });
      });
    });
    out.sort(function (x, y) { return (y.ep.pub - x.ep.pub) || cmpStr(x.ep.id, y.ep.id); });
    return max ? out.slice(0, max) : out;
  }
  // "Continue listening": started, not finished, most recent first.
  function inProgress(data) {
    return (data.eps || []).filter(function (e) { return e.p > 0 && !e.x; })
      .sort(function (x, y) { return (y.m - x.m) || cmpStr(x.id, y.id); });
  }
  function filterEpisodes(data, sid, eps, f) {
    return (eps || []).filter(function (e) {
      var st = stateOf(data, { id: e.id, s: sid, pd: e.pub });
      if (f === "unplayed") return !st.x;
      if (f === "progress") return st.p > 0 && !st.x;
      if (f === "played") return !!st.x;
      return true;
    });
  }
  function searchShows(shows, q) {
    q = fold(clean(q, 100));
    if (!q) return shows.slice();
    return shows.filter(function (s) { return fold(s.title + " " + s.by).indexOf(q) >= 0; });
  }

  root.OrosPodcastsCore = {
    DATA_VER: DATA_VER, LIM: LIM, SPEEDS: SPEEDS, PREF_DEF: PREF_DEF, SYNC_EVERY: SYNC_EVERY, SYNC_MIN_MOVE: SYNC_MIN_MOVE,
    clean: clean, fold: fold, plain: plain, decodeEntities: decodeEntities,
    safeUrl: safeUrl, feedKey: feedKey, hash13: hash13, showId: showId, episodeId: episodeId,
    appleId: appleId, appleLookupUrl: appleLookupUrl,
    fromDom: fromDom, parseFeed: parseFeed, parseDate: parseDate,
    parseDuration: parseDuration, fmtTime: fmtTime, noteStamps: noteStamps, normChapters: normChapters, chapterAt: chapterAt,
    appleSearchUrl: appleSearchUrl, fyydSearchUrl: fyydSearchUrl, parseAppleResults: parseAppleResults,
    parseFyydResults: parseFyydResults, mergeResults: mergeResults,
    normShow: normShow, normEp: normEp, normQueue: normQueue, normPrefs: normPrefs, prefOf: prefOf, emptyData: emptyData,
    mergePodcasts: mergePodcasts,
    subscribe: subscribe, unsubscribe: unsubscribe, editShow: editShow, moveShow: moveShow, setProgress: setProgress, stateOf: stateOf,
    markAllPlayed: markAllPlayed, compactShow: compactShow, setPref: setPref, findShow: findShow,
    queueAdd: queueAdd, queueRemove: queueRemove, queueMove: queueMove, queueNext: queueNext,
    shouldCommit: shouldCommit,
    newEpisodes: newEpisodes, inProgress: inProgress, filterEpisodes: filterEpisodes, searchShows: searchShows
  };
})(typeof window !== "undefined" ? window : this);
