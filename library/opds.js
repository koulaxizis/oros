// ============================================================
// orOS Library — online catalogues (OPDS), pure part (wave 33)
// No DOM, no network: testable under Node (tests/library-opds.test.js).
//   - parseFeed(text, base): OPDS 1.x (Atom XML, also a plain Atom
//     feed whose entries carry ebook enclosures, such as Standard
//     Ebooks' free "new releases") and OPDS 2.0 (JSON) → one shape:
//     { title, entries[], next, prev, start, up, search, osd }
//     entry = { kind: "nav" | "book" | "head", title, by, summary,
//               lang, year, thumb, nav, links[{ url, fmt, type, size }] }
//   - parseOsd(xml, base): the OpenSearch description → a template
//   - searchUrl(template, terms): fills {searchTerms} / {?query}
//   - fmtOfType(type, href): "epub" | "pdf" | "cbz" | "cbr" | "fb2" | null
//   - sniff(bytes): what a downloaded file really is (magic bytes)
//   - fileName(title, fmt): a safe file name for the disk
// Every address is resolved against the feed's own and kept only
// when it is http(s); pictures only https (the page is https). Text
// is plain (tags stripped, entities decoded): the UI draws it with
// textContent. Nothing in a feed is ever run.
// Exposes window.LibOpds (browser) or module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var C = root.LibCore || (typeof require === "function" ? require("./core.js") : null);
  var MAX_ENTRIES = 500;
  var TITLE_LEN = 200, BY_LEN = 120, SUM_LEN = 600;

  // The catalogues every library has. Project Gutenberg's OPDS 1.x
  // catalogue (browse + search); Standard Ebooks' full OPDS catalogue
  // is for its Patrons Circle only (it asks for a login), so the free
  // "new releases" Atom feed is used: its entries carry EPUB enclosures.
  var BUILTIN = [
    { id: "gutenberg", name: "Project Gutenberg", url: "https://www.gutenberg.org/ebooks.opds/",
      search: "https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}", site: "https://www.gutenberg.org/" },
    { id: "stdebooks", name: "Standard Ebooks", url: "https://standardebooks.org/feeds/atom/new-releases",
      search: "", site: "https://standardebooks.org/" }
  ];

  var ACQ_TYPES = {
    "application/epub+zip": "epub",
    "application/pdf": "pdf",
    "application/x-cbz": "cbz", "application/vnd.comicbook+zip": "cbz",
    "application/x-cbr": "cbr", "application/vnd.comicbook-rar": "cbr",
    "application/x-fictionbook+xml": "fb2", "application/fb2+zip": "fb2", "application/x-zip-compressed-fb2": "fb2"
  };
  var FMT_ORDER = ["epub", "pdf", "cbz", "cbr", "fb2"];
  var FMT_EXT = { epub: "epub", pdf: "pdf", cbz: "cbz", cbr: "cbr", fb2: "fb2" };

  function str(s) { return typeof s === "string" ? s : ""; }
  // Plain text: tags out, entities decoded; twice, for escaped HTML
  // ("&lt;p&gt;…") as Atom "html" content carries it.
  var INLINE_RE = /<\/?(i|b|em|strong|a|span|sup|sub|small|abbr|cite|q|u|code)\b[^>]*>/gi;
  function plain(s, max) {
    var t = C.cleanText(C.decodeEnt(str(s).replace(INLINE_RE, "")).replace(INLINE_RE, ""));
    return max && t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  function absUrl(href, base, httpsOnly) {
    href = str(href).trim();
    if (!href || href.length > 2000) return "";
    var u;
    try { u = base ? new URL(href, base) : new URL(href); } catch (e) { return ""; }
    if (u.protocol !== "https:" && (httpsOnly || u.protocol !== "http:")) return "";
    if (u.username || u.password) return "";
    u.hash = "";
    return u.href;
  }
  function mediaType(t) { return str(t).toLowerCase().split(";")[0].trim(); }
  function fmtOfType(type, href) {
    var f = ACQ_TYPES[mediaType(type)];
    if (f) return f;
    // A link without a usable type: the file name may say.
    var p = str(href).toLowerCase().split(/[?#]/)[0];
    if (/\.kepub\.epub$/.test(p)) return null;
    var m = /\.(epub|pdf|cbz|cbr|fb2)$/.exec(p);
    return m && (!type || mediaType(type) === "application/octet-stream") ? m[1] : null;
  }
  function isAcqRel(rel) {
    rel = str(rel);
    if (rel === "enclosure") return true;
    if (rel.indexOf("http://opds-spec.org/acquisition") !== 0) return false;
    // buying, borrowing and subscribing need an account at the seller
    return !/\/(buy|borrow|subscribe|sample|preview)$/.test(rel);
  }
  function isNavType(type) {
    var t = str(type).toLowerCase();
    return t.indexOf("application/atom+xml") === 0 || t.indexOf("application/opds+json") === 0 ||
      t.indexOf("profile=opds-catalog") >= 0;
  }
  var NAV_SKIP = { self: 1, up: 1, start: 1, search: 1, next: 1, previous: 1, prev: 1, first: 1, last: 1,
                   alternate: 1, "http://opds-spec.org/shelf": 1, "http://opds-spec.org/facet": 1 };
  function isThumbRel(rel) {
    return /^http:\/\/opds-spec\.org\/(image\/)?thumbnail$/.test(rel) || rel === "x-stanza-cover-image-thumbnail";
  }
  function isImageRel(rel) {
    return rel === "http://opds-spec.org/image" || rel === "http://opds-spec.org/cover" || rel === "x-stanza-cover-image";
  }
  function addLink(list, url, fmt, type, size) {
    if (!url || !fmt) return;
    for (var i = 0; i < list.length; i++) if (list[i].fmt === fmt) return;     // one per format: the first
    var o = { url: url, fmt: fmt, type: mediaType(type) };
    if (size > 0) o.size = size;
    list.push(o);
  }
  function sortLinks(list) {
    return list.sort(function (a, b) { return FMT_ORDER.indexOf(a.fmt) - FMT_ORDER.indexOf(b.fmt); });
  }
  function yearOf(s) {
    var m = /^\s*(-?\d{4})/.exec(str(s));
    var y = m ? +m[1] : 0;
    return y >= 1 && y <= 9999 ? y : 0;
  }
  function langOf(s) {
    s = str(s).trim();
    return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(s) ? s : "";
  }
  function emptyFeed() { return { title: "", entries: [], next: "", prev: "", start: "", up: "", search: "", osd: "" }; }

  // ---------- OPDS 1.x / Atom ----------
  function parseAtom(text, base) {
    var r = C.xmlParse(text);
    var feed = C.kids(r, "feed")[0] || null;
    if (!feed) {
      var e1 = C.kids(r, "entry")[0];          // a single-entry document (Gutenberg's book pages are feeds; some servers send an entry)
      if (!e1) return null;
      feed = { n: "feed", l: "feed", a: {}, c: [e1] };
    }
    var out = emptyFeed();
    var xb = C.attr(feed, "base");
    if (xb) base = absUrl(xb, base) || base;
    out.title = plain(C.textOf(C.kids(feed, "title")[0]), TITLE_LEN);
    C.kids(feed, "link").forEach(function (l) {
      var rel = str(C.attr(l, "rel")), type = C.attr(l, "type");
      var href = absUrl(C.attr(l, "href"), base);
      if (rel === "search") {
        var raw = str(C.attr(l, "href"));
        if (mediaType(type) === "application/opensearchdescription+xml") { if (!out.osd) out.osd = href; }
        else if (/\{searchTerms\}/.test(raw) && !out.search) out.search = templateUrl(raw, base);
        return;
      }
      if (!href) return;
      if (rel === "next" && !out.next) out.next = href;
      else if ((rel === "previous" || rel === "prev") && !out.prev) out.prev = href;
      else if (rel === "start" && !out.start) out.start = href;
      else if (rel === "up" && !out.up) out.up = href;
    });
    C.kids(feed, "entry").slice(0, MAX_ENTRIES).forEach(function (e) {
      var x = { kind: "nav", title: plain(C.textOf(C.kids(e, "title")[0]), TITLE_LEN), by: "", summary: "",
                lang: "", year: 0, thumb: "", nav: "", links: [] };
      x.by = C.kids(e, "author").map(function (a) { return plain(C.textOf(C.kids(a, "name")[0] || a)); })
        .filter(Boolean).slice(0, 3).join(", ").slice(0, BY_LEN);
      var sum = C.kids(e, "summary")[0] || C.kids(e, "content")[0];
      x.summary = plain(C.textOf(sum), SUM_LEN);
      x.lang = langOf(C.textOf(C.kids(e, "language")[0]));
      x.year = yearOf(C.textOf(C.kids(e, "issued")[0])) || yearOf(C.textOf(C.kids(e, "published")[0]));
      var img = "";
      C.kids(e, "link").forEach(function (l) {
        var rel = str(C.attr(l, "rel")), type = C.attr(l, "type");
        var href = absUrl(C.attr(l, "href"), base);
        if (!href) return;
        if (isAcqRel(rel)) {
          var len = parseInt(C.attr(l, "length"), 10);
          addLink(x.links, href, fmtOfType(type, href), type, isFinite(len) ? len : 0);
          return;
        }
        if (isThumbRel(rel)) { if (!x.thumb) x.thumb = absUrl(href, null, true); return; }
        if (isImageRel(rel)) { if (!img) img = absUrl(href, null, true); return; }
        if (!x.nav && !NAV_SKIP[rel] && isNavType(type)) x.nav = href;
      });
      if (!x.thumb) {
        var mt = C.kids(e, "thumbnail")[0];             // media:thumbnail (Standard Ebooks)
        if (mt) x.thumb = absUrl(C.attr(mt, "url"), base, true);
      }
      if (!x.thumb) x.thumb = img;
      sortLinks(x.links);
      if (x.links.length) x.kind = "book";
      else if (!x.nav) return;                          // nothing to open or download
      if (!x.title) x.title = "?";
      out.entries.push(x);
    });
    return out;
  }

  // ---------- OPDS 2.0 (JSON) ----------
  function relList(l) {
    var r = l && l.rel;
    return Array.isArray(r) ? r.map(str) : [str(r)];
  }
  function contributors(v) {
    var list = Array.isArray(v) ? v : (v ? [v] : []);
    return list.map(function (a) { return typeof a === "string" ? a : (a && typeof a === "object" ? str(a.name) : ""); })
      .map(function (s) { return plain(s); }).filter(Boolean).slice(0, 3).join(", ").slice(0, BY_LEN);
  }
  function multi(v) {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") { var k = Object.keys(v)[0]; return k ? str(v[k]) : ""; }   // language map
    return "";
  }
  function pubEntry(p, base) {
    if (!p || typeof p !== "object") return null;
    var md = p.metadata && typeof p.metadata === "object" ? p.metadata : {};
    var x = { kind: "book", title: plain(multi(md.title), TITLE_LEN) || "?", by: contributors(md.author),
              summary: plain(md.description, SUM_LEN), lang: langOf(Array.isArray(md.language) ? md.language[0] : md.language),
              year: yearOf(md.published), thumb: "", nav: "", links: [] };
    (Array.isArray(p.links) ? p.links : []).forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var href = absUrl(l.href, base);
      if (!href) return;
      var rels = relList(l);
      if (rels.some(isAcqRel)) {
        addLink(x.links, href, fmtOfType(l.type, href), l.type, 0);
      } else if (!x.nav && rels.indexOf("self") >= 0 && isNavType(l.type)) {
        x.nav = href;
      }
    });
    var imgs = (Array.isArray(p.images) ? p.images : []).filter(function (im) { return im && typeof im === "object"; });
    imgs.sort(function (a, b) { return (+a.width || 9999) - (+b.width || 9999); });
    for (var i = 0; i < imgs.length && !x.thumb; i++) x.thumb = absUrl(imgs[i].href, base, true);
    sortLinks(x.links);
    if (!x.links.length) {
      if (!x.nav) return null;
      x.kind = "nav";
    }
    return x;
  }
  function navEntry(l, base) {
    if (!l || typeof l !== "object") return null;
    var href = absUrl(l.href, base);
    if (!href) return null;
    return { kind: "nav", title: plain(l.title, TITLE_LEN) || "?", by: "", summary: "", lang: "", year: 0,
             thumb: "", nav: href, links: [] };
  }
  function parseJson(obj, base) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    var out = emptyFeed();
    var md = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {};
    out.title = plain(multi(md.title), TITLE_LEN);
    (Array.isArray(obj.links) ? obj.links : []).forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var rels = relList(l);
      if (rels.indexOf("search") >= 0) {
        if (l.templated && !out.search) out.search = templateUrl(str(l.href), base);
        else if (mediaType(l.type) === "application/opensearchdescription+xml" && !out.osd) out.osd = absUrl(l.href, base);
        return;
      }
      var href = absUrl(l.href, base);
      if (!href) return;
      if (rels.indexOf("next") >= 0 && !out.next) out.next = href;
      else if ((rels.indexOf("previous") >= 0 || rels.indexOf("prev") >= 0) && !out.prev) out.prev = href;
      else if (rels.indexOf("start") >= 0 && !out.start) out.start = href;
      else if (rels.indexOf("up") >= 0 && !out.up) out.up = href;
    });
    function take(o) {
      (Array.isArray(o.navigation) ? o.navigation : []).forEach(function (l) {
        var e = navEntry(l, base);
        if (e && out.entries.length < MAX_ENTRIES) out.entries.push(e);
      });
      (Array.isArray(o.publications) ? o.publications : []).forEach(function (p) {
        var e = pubEntry(p, base);
        if (e && out.entries.length < MAX_ENTRIES) out.entries.push(e);
      });
    }
    take(obj);
    (Array.isArray(obj.groups) ? obj.groups : []).forEach(function (g) {
      if (!g || typeof g !== "object" || out.entries.length >= MAX_ENTRIES) return;
      var gm = g.metadata && typeof g.metadata === "object" ? g.metadata : {};
      var title = plain(multi(gm.title), TITLE_LEN);
      var more = "";
      (Array.isArray(g.links) ? g.links : []).forEach(function (l) {
        if (!more && l && relList(l).indexOf("self") >= 0) more = absUrl(l.href, base);
      });
      if (title) out.entries.push({ kind: "head", title: title, by: "", summary: "", lang: "", year: 0, thumb: "", nav: more, links: [] });
      take(g);
    });
    return out;
  }

  // text → feed, or null when it is neither OPDS / Atom nor OPDS 2.
  function parseFeed(text, base) {
    text = str(text).replace(/^﻿/, "");
    var head = text.slice(0, 200).trim();
    if (head.charAt(0) === "{") {
      var obj = null;
      try { obj = JSON.parse(text); } catch (e) { return null; }
      return parseJson(obj, base);
    }
    if (head.charAt(0) !== "<") return null;
    return parseAtom(text, base);
  }

  // An OpenSearch description → the Atom (else any) template.
  function parseOsd(xml, base) {
    var r = C.xmlParse(xml), feedT = "", anyT = "";
    C.findAllNodes(r, "url").forEach(function (u) {
      var tpl = str(C.attr(u, "template")), type = mediaType(C.attr(u, "type"));
      if (!/\{searchTerms\}/.test(tpl)) return;
      var full = templateUrl(tpl, base);
      if (!full) return;
      if (type === "application/atom+xml" || type === "application/opds+json") { if (!feedT) feedT = full; }
      else if (!anyT && type !== "text/html") anyT = full;
    });
    return feedT || anyT;
  }
  // A search template made absolute; its {placeholders} survive.
  function templateUrl(tpl, base) {
    tpl = str(tpl).trim();
    if (!tpl) return "";
    var mark = "x0searchx0";
    var probe = tpl.replace(/\{[^}]*\}/g, function (m) { return mark + encodeURIComponent(m).replace(/%/g, "_") + mark; });
    var abs = absUrl(probe, base);
    if (!abs) return "";
    return abs.replace(new RegExp(mark + "([^]*?)" + mark, "g"), function (_, enc) {
      try { return decodeURIComponent(enc.replace(/_/g, "%")); } catch (e) { return ""; }
    });
  }
  function searchUrl(template, terms) {
    terms = str(terms).trim();
    if (!template || !terms) return "";
    var q = encodeURIComponent(terms);
    var u = template.replace(/\{searchTerms\}/g, q)
      .replace(/\{\?([^}]*)\}/g, function (_, vars) {      // RFC 6570 form-style query (OPDS 2)
        return vars.split(",").indexOf("query") >= 0 ? "?query=" + q : "";
      })
      .replace(/\{&([^}]*)\}/g, function (_, vars) {
        return vars.split(",").indexOf("query") >= 0 ? "&query=" + q : "";
      })
      .replace(/\{[^}]*\?\}/g, "")                         // optional OpenSearch parameters
      .replace(/\{[^}]*\}/g, "");
    return absUrl(u, null) ? u : "";
  }

  // What the downloaded bytes are, from their first bytes.
  function sniff(b) {
    if (!b || b.length < 4) return null;
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return "rar";
    var head = "";
    for (var i = 0; i < Math.min(400, b.length); i++) head += String.fromCharCode(b[i]);
    if (/<FictionBook\b/i.test(head)) return "fb2";
    if (/^\s*(<!doctype html|<html)/i.test(head)) return "html";
    return null;
  }
  // Does what arrived match the format we asked for?
  function sniffOk(fmt, b) {
    var k = sniff(b);
    if (fmt === "epub" || fmt === "cbz") return k === "zip";
    if (fmt === "pdf") return k === "pdf";
    if (fmt === "cbr") return k === "rar";
    if (fmt === "fb2") return k === "fb2" || k === "zip";
    return false;
  }
  function fileName(title, fmt) {
    var n = str(title).replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
      .replace(/^[.\s]+|[.\s]+$/g, "");
    var ext = FMT_EXT[fmt] || "bin";
    if (fmt === "fb2") ext = "fb2";
    return (n || "book") + "." + ext;
  }
  // A catalogue address typed by the user (http(s) only), or "".
  function catUrl(s) {
    s = str(s).trim();
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
    return absUrl(s, null);
  }

  var api = {
    BUILTIN: BUILTIN, parseFeed: parseFeed, parseOsd: parseOsd, searchUrl: searchUrl, templateUrl: templateUrl,
    fmtOfType: fmtOfType, sniff: sniff, sniffOk: sniffOk, fileName: fileName, catUrl: catUrl, absUrl: absUrl
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LibOpds = api;
})(typeof window !== "undefined" ? window : globalThis);
