// ============================================================
// orOS Reader — core (pure, no DOM)
// Everything the app does that is not UI, kept free of the DOM so
// Node can test it (tests/feeds.test.js):
//   1. helpers: hash, URLs, entities, text, dates, bytes → text
//   2. a lenient XML reader (feeds in the wild are often not
//      well-formed: a strict parser would refuse them)
//   3. feed parsers: RSS 0.9x / 2.0, RSS 1.0 (RDF), Atom 1.0,
//      JSON Feed 1.x → one item shape
//   4. feed discovery: <link rel="alternate">, platform rules
//      (YouTube, Reddit, Mastodon, GitHub, …), feed-like links,
//      common paths
//   5. OPML import / export
//   6. the synced data model "feeds": subscriptions, folders,
//      saved (starred / read-later) articles, settings, read
//      state; normalizers + a symmetric, canonical merge (R5,
//      R17, R26)
//   7. refresh timing (interval, ttl, backoff)
// Exposed as window.orosFeedsCore; module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Helpers ----------
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }
  function oneLine(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // cyrb53: 53-bit string hash, written out in base 36 (11 chars max)
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    var s = n.toString(36);
    while (s.length < 11) s = "0" + s;
    return s;
  }

  // A feed's address, written one way only: the same feed added on two
  // devices gets the same id (no duplicates after sync).
  function normUrl(u) {
    u = String(u || "").trim();
    if (!u || u.length > 2000 || /\s/.test(u)) return "";
    if (/^feed:\/\//i.test(u)) u = u.replace(/^feed:\/\//i, "https://");
    else if (/^feed:/i.test(u)) u = u.slice(5);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u.replace(/^\/+/, "");
    var x;
    try { x = new URL(u); } catch (e) { return ""; }
    if (x.protocol !== "https:" && x.protocol !== "http:") return "";
    if (x.username || x.password) return "";
    var host = x.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || host.indexOf(".") < 0) return "";
    x.hash = "";
    var out = x.href;
    if (out.length > 2000) return "";
    return out;
  }
  function feedId(url) { var n = normUrl(url); return n ? "f" + hash(n.replace(/^https?:\/\//, "")) : ""; }
  function itemId(fid, key) { return "i" + hash(fid + "\n" + key); }

  function absUrl(href, base) {
    href = String(href || "").trim();
    if (!href) return "";
    try {
      var x = new URL(href, base || undefined);
      if (x.protocol !== "https:" && x.protocol !== "http:") return "";
      return x.href.length <= 2000 ? x.href : "";
    } catch (e) { return ""; }
  }
  function httpUrl(u) {   // a stored link: http(s) only, else ""
    u = String(u || "").trim();
    return /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 2000 ? u : "";
  }
  function siteOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

  var ENT = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", hellip: "…",
    mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", sbquo: "‚",
    ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
    copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
    middot: "·", bull: "•", deg: "°", times: "×", shy: "\u00ad",
    zwnj: "\u200c", zwj: "\u200d", lrm: "\u200e", rlm: "\u200f", thinsp: "\u2009",
    ensp: "\u2002", emsp: "\u2003", iexcl: "¡", iquest: "¿", sect: "§",
    para: "¶", eacute: "é", egrave: "è", aacute: "á", agrave: "à",
    oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", ccedil: "ç",
    uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß"
  };
  function fromCode(n) {
    if (!isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "\ufffd";
    return String.fromCodePoint(n);
  }
  function decodeEntities(s) {
    s = String(s || "");
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,15});?/g, function (m, e) {
      if (e[0] === "#") return fromCode(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      var v = ENT[e] !== undefined ? ENT[e] : ENT[e.toLowerCase()];
      return v !== undefined ? v : m;
    });
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Plain text of an HTML fragment (titles, snippets, saved summaries).
  function textOf(html) {
    var s = String(html || "");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    s = s.replace(/<(script|style|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, " ");
    s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, " ");
    s = s.replace(/<[^>]*>/g, "");
    s = s.replace(/</g, " ");
    return oneLine(decodeEntities(s));
  }
  // Titles: plain text that is often HTML-escaped and sometimes carries
  // real inline markup. Only known tags are markup: "Πρώτο <άρθρο>" stays.
  var INLINE_TAG = /<\/?(a|abbr|b|big|br|cite|code|del|em|font|i|ins|kbd|mark|p|q|s|small|span|strike|strong|sub|sup|time|u|wbr)\b[^>]*>/gi;
  function titleText(s) {
    s = String(s || "").replace(INLINE_TAG, "");
    return clip(oneLine(decodeEntities(s)), 300);
  }

  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var ZONES = { ut: 0, utc: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420,
                mdt: -360, pst: -480, pdt: -420, cet: 60, cest: 120, eet: 120, eest: 180, bst: 60,
                ist: 330, jst: 540, aest: 600, aedt: 660, msk: 180, wet: 0, west: 60 };
  function parseDate(s) {
    s = oneLine(s);
    if (!s) return 0;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?)?/i.exec(s);
    if (m) {
      var off = 0, z = m[8];
      if (z && z.toUpperCase() !== "Z") {
        var zz = z.replace(":", "");
        off = (zz[0] === "-" ? -1 : 1) * (+zz.slice(1, 3) * 60 + +(zz.slice(3, 5) || 0));
      }
      var ms = m[7] ? Math.round(+("0." + m[7]) * 1000) : 0;
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms) - off * 60000;
      return isFinite(t) ? t : 0;
    }
    var r = /(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*\.?,?[\s-]+(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|[A-Za-z]{1,5})?/.exec(s);
    if (r) {
      var mon = MON[r[2].toLowerCase()];
      if (mon !== undefined) {
        var y = +r[3];
        if (y < 100) y += y < 50 ? 2000 : 1900;
        var o = 0, zn = r[7];
        if (zn && /^[+-]/.test(zn)) { zn = zn.replace(":", ""); o = (zn[0] === "-" ? -1 : 1) * (+zn.slice(1, 3) * 60 + +zn.slice(3, 5)); }
        else if (zn && ZONES[zn.toLowerCase()] !== undefined) o = ZONES[zn.toLowerCase()];
        var tt = Date.UTC(y, mon, +r[1], +r[4], +r[5], +(r[6] || 0)) - o * 60000;
        if (isFinite(tt)) return tt;
      }
    }
    var d = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(s.replace(/^[A-Za-z]{3},?\s*/, ""));
    if (d && MON[d[2].toLowerCase()] !== undefined) return Date.UTC(+d[3], MON[d[2].toLowerCase()], +d[1]);
    var p = Date.parse(s);
    return isFinite(p) ? p : 0;
  }

  // Bytes → text. Charset from the HTTP header, else the XML prolog or
  // <meta charset>, else a BOM, else UTF-8 (Greek sites still serve
  // ISO-8859-7 and Windows-1253).
  var CS_ALIAS = { "utf8": "utf-8", "iso8859-7": "iso-8859-7", "greek": "iso-8859-7", "elot_928": "iso-8859-7",
                   "cp1253": "windows-1253", "win-1253": "windows-1253", "latin1": "iso-8859-1" };
  function sniffCharset(bytes, contentType) {
    var m = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType || ""));
    if (m) return m[1].toLowerCase();
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
    var head = "";
    for (var i = 0; i < Math.min(bytes.length, 1024); i++) head += String.fromCharCode(bytes[i]);
    var x = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) ||
            /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
    return x ? x[1].toLowerCase() : "utf-8";
  }
  function decodeBytes(bytes, contentType) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
    var cs = sniffCharset(bytes, contentType);
    cs = CS_ALIAS[cs] || cs;
    var dec;
    try { dec = new TextDecoder(cs); } catch (e) { dec = new TextDecoder("utf-8"); }
    return dec.decode(bytes).replace(/^\ufeff/, "");
  }
  function b64ToBytes(s) {
    var bin;
    try { bin = atob(String(s || "")); } catch (e) { return new Uint8Array(0); }
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // ---------- 2. Lenient XML reader ----------
  // Node: { n: "name" (lower case, prefix kept), a: {attrs}, c: [children] }
  // Children are nodes or strings (text, entities decoded; CDATA as is).
  var MAX_DEPTH = 64;
  function parseAttrs(s) {
    var out = {}, re = /([^\s=\/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?/g, m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (out[k] !== undefined) continue;
      var v = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ""));
      out[k] = decodeEntities(v);
    }
    return out;
  }
  function parseXml(s) {
    s = String(s || "");
    var rootNode = { n: "#root", a: {}, c: [] }, stack = [rootNode], i = 0, n = s.length;
    function top() { return stack[stack.length - 1]; }
    function text(t) { if (t) top().c.push(t); }
    while (i < n) {
      var lt = s.indexOf("<", i);
      if (lt < 0) { text(decodeEntities(s.slice(i))); break; }
      if (lt > i) text(decodeEntities(s.slice(i, lt)));
      var e;
      if (s.startsWith("<!--", lt)) { e = s.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (s.startsWith("<![CDATA[", lt)) {
        e = s.indexOf("]]>", lt + 9);
        text(s.slice(lt + 9, e < 0 ? n : e));
        i = e < 0 ? n : e + 3;
        continue;
      }
      var c1 = s.charAt(lt + 1);
      if (c1 === "?") { e = s.indexOf("?>", lt); i = e < 0 ? n : e + 2; continue; }
      if (c1 === "!") {
        var j = lt + 2, depth = 0;
        while (j < n) { var ch = s[j]; if (ch === "[") depth++; else if (ch === "]") depth--; else if (ch === ">" && depth <= 0) break; j++; }
        i = j + 1;
        continue;
      }
      if (c1 === "/") {
        e = s.indexOf(">", lt);
        var cname = s.slice(lt + 2, e < 0 ? n : e).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) {
          if (stack[k].n === cname) { stack.length = k; break; }
        }
        i = e < 0 ? n : e + 1;
        continue;
      }
      var m = /^<([A-Za-z_][\w:.\-]*)/.exec(s.slice(lt, lt + 256));
      if (!m) { text("<"); i = lt + 1; continue; }
      // find the end of the tag, outside quotes
      var p = lt + m[0].length, q = "";
      while (p < n) {
        var cc = s[p];
        if (q) { if (cc === q) q = ""; }
        else if (cc === "\"" || cc === "'") q = cc;
        else if (cc === ">") break;
        p++;
      }
      var inner = s.slice(lt + m[0].length, p);
      var self = /\/\s*$/.test(inner);
      var node = { n: m[1].toLowerCase(), a: parseAttrs(self ? inner.replace(/\/\s*$/, "") : inner), c: [] };
      top().c.push(node);
      if (!self && stack.length < MAX_DEPTH) stack.push(node);
      i = p + 1;
    }
    return rootNode;
  }
  function kids(node, name) {
    var out = [];
    if (!node) return out;
    for (var i = 0; i < node.c.length; i++) {
      var k = node.c[i];
      if (typeof k !== "string" && (!name || k.n === name)) out.push(k);
    }
    return out;
  }
  function kid(node, names) {
    if (!node) return null;
    names = [].concat(names);
    for (var j = 0; j < names.length; j++) {
      for (var i = 0; i < node.c.length; i++) {
        var k = node.c[i];
        if (typeof k !== "string" && k.n === names[j]) return k;
      }
    }
    return null;
  }
  function deepText(node) {
    if (!node) return "";
    var out = "";
    for (var i = 0; i < node.c.length; i++) {
      var k = node.c[i];
      out += typeof k === "string" ? k : deepText(k);
    }
    return out;
  }
  function kidText(node, names) { return deepText(kid(node, names)).trim(); }
  // Children back to markup (Atom type="xhtml").
  function serialize(node) {
    var out = "";
    for (var i = 0; i < node.c.length; i++) {
      var k = node.c[i];
      if (typeof k === "string") { out += escHtml(k); continue; }
      var name = k.n.replace(/^[\w.-]+:/, "");
      out += "<" + name;
      Object.keys(k.a).forEach(function (an) {
        if (/^xmlns/.test(an)) return;
        out += " " + an.replace(/^[\w.-]+:/, "") + "=\"" + escHtml(k.a[an]) + "\"";
      });
      out += ">" + serialize(k) + "</" + name + ">";
    }
    return out;
  }
  // Drop the root's own namespace prefix ("atom:feed" → "feed").
  function stripPrefix(node, prefix) {
    if (!prefix) return node;
    var re = new RegExp("^" + prefix.replace(/[.\-]/g, "\\$&") + ":");
    (function walk(x) {
      x.n = x.n.replace(re, "");
      x.c.forEach(function (k) { if (typeof k !== "string") walk(k); });
    })(node);
    return node;
  }

  // ---------- 3. Feed parsers ----------
  var MAX_ITEMS = 500;
  var MAX_HTML = 1024 * 1024;

  function firstImg(html, base) {
    var m = /<img\b[^>]*?\s(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i.exec(String(html || ""));
    if (!m) return "";
    var u = absUrl(decodeEntities(m[1]), base);
    if (!u || /\b(pixel|tracking|feedburner\.com\/~r|stats\.wordpress\.com|1x1|spacer)\b/i.test(u)) return "";
    return u;
  }
  function mediaImage(node, base) {
    var th = kid(node, "media:thumbnail");
    if (th && th.a.url) return absUrl(th.a.url, base);
    var grp = kid(node, "media:group");
    if (grp) { var gth = kid(grp, "media:thumbnail"); if (gth && gth.a.url) return absUrl(gth.a.url, base); }
    var mcs = kids(node, "media:content").concat(grp ? kids(grp, "media:content") : []);
    for (var i = 0; i < mcs.length; i++) {
      var mc = mcs[i];
      if (mc.a.url && (mc.a.medium === "image" || /^image\//.test(mc.a.type || "") ||
          (!mc.a.type && !mc.a.medium && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(mc.a.url)))) return absUrl(mc.a.url, base);
    }
    var it = kid(node, "itunes:image");
    if (it && it.a.href) return absUrl(it.a.href, base);
    return "";
  }
  function enclosureOf(list, base) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i], url = absUrl(e.url, base), type = String(e.type || "").toLowerCase();
      if (!url) continue;
      if (/^(audio|video)\//.test(type) || (!type && /\.(mp3|m4a|aac|ogg|oga|opus|wav|mp4|m4v|webm)(\?|$)/i.test(url))) {
        var len = parseInt(e.length, 10);
        return { url: url, type: clip(type, 60), len: isFinite(len) && len > 0 ? len : 0 };
      }
    }
    return null;
  }
  function finishItem(it, base) {
    var html = String(it.html || "");
    if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
    var link = absUrl(it.link, base);
    var title = it.plain ? clip(oneLine(it.title), 300) : titleText(it.title);
    var text = textOf(html);
    if (!title) title = clip(text, 90) + (text.length > 90 ? "…" : "");
    return {
      key: clip(oneLine(it.key || link || (title + "|" + (it.date || ""))), 500),
      title: title,
      link: link,
      date: it.date || 0,
      author: clip(oneLine(textOf(it.author)), 120),
      html: html,
      snip: clip(text, 240),
      img: it.img || firstImg(html, link || base),
      enc: it.enc || null
    };
  }
  function linkHref(node, base) {   // Atom: rel="alternate" (or none) wins
    var links = kids(node, "link"), alt = "", any = "";
    for (var i = 0; i < links.length; i++) {
      var l = links[i], rel = (l.a.rel || "alternate").toLowerCase();
      var h = l.a.href || deepText(l).trim();
      if (!h) continue;
      if (rel === "alternate" && (!l.a.type || /html/i.test(l.a.type)) && !alt) alt = h;
      if (!any && rel !== "self" && rel !== "enclosure" && rel !== "hub" && rel !== "replies") any = h;
    }
    return absUrl(alt || any, base);
  }
  function atomTitle(node) {   // -> plain text
    if (!node) return "";
    var type = (node.a.type || "text").toLowerCase();
    if (type === "xhtml") return textOf(serialize(kid(node, ["div", "xhtml:div"]) || node));
    if (type === "html" || type === "text/html") return textOf(deepText(node));
    return oneLine(deepText(node));
  }
  function atomText(node) {
    if (!node) return "";
    var type = (node.a.type || "text").toLowerCase();
    if (type === "xhtml") { var div = kid(node, ["div", "xhtml:div"]); return serialize(div || node); }
    if (type === "html" || type === "text/html") return deepText(node);
    return escHtml(deepText(node)).replace(/\n/g, "<br>");
  }

  function parseRss(ch, items, base, kind) {
    var link = absUrl(kidText(ch, "link") || (kid(ch, "atom:link") || { a: {} }).a.href, base);
    var img = kid(ch, "image");
    var ttl = parseInt(kidText(ch, "ttl"), 10);
    var per = { hourly: 60, daily: 1440, weekly: 10080, monthly: 43200, yearly: 525600 }[kidText(ch, "sy:updateperiod").toLowerCase()];
    var freq = parseInt(kidText(ch, "sy:updatefrequency"), 10) || 1;
    var out = {
      kind: kind,
      title: titleText(kidText(ch, "title")),
      site: link,
      desc: clip(textOf(kidText(ch, "description")), 500),
      icon: img ? absUrl(kidText(img, "url"), base) : "",
      ttl: ttl > 0 ? ttl : (per ? Math.round(per / freq) : 0),
      items: []
    };
    items.slice(0, MAX_ITEMS).forEach(function (it) {
      var guid = kid(it, "guid");
      var guidText = guid ? deepText(guid).trim() : "";
      var lnk = kidText(it, "link") || kidText(it, "feedburner:origlink");
      if (!lnk && guid && !/^false$/i.test(guid.a.ispermalink || "") && /^https?:/i.test(guidText)) lnk = guidText;
      if (!lnk) { var al = kid(it, "atom:link"); if (al) lnk = al.a.href; }
      var html = kidText(it, "content:encoded") || kidText(it, "description") || kidText(it, "summary");
      var encs = kids(it, "enclosure").map(function (e) { return { url: e.a.url, type: e.a.type, length: e.a.length }; })
        .concat(kids(it, "media:content").map(function (e) { return { url: e.a.url, type: e.a.type, length: e.a.filesize }; }));
      var encl = enclosureOf(encs, base);
      var img = mediaImage(it, base);
      if (!img) {
        var ie = kids(it, "enclosure").filter(function (e) { return /^image\//i.test(e.a.type || ""); })[0];
        if (ie) img = absUrl(ie.a.url, base);
      }
      out.items.push(finishItem({
        key: guidText || lnk,
        title: kidText(it, "title"),
        link: lnk,
        date: parseDate(kidText(it, "pubdate") || kidText(it, "dc:date") || kidText(it, "published") || kidText(it, "updated")),
        author: kidText(it, "dc:creator") || kidText(it, "author") || kidText(it, "itunes:author"),
        html: html,
        img: img,
        enc: encl
      }, base));
    });
    return out;
  }

  function parseAtom(feed, base) {
    var xb = feed.a["xml:base"] ? absUrl(feed.a["xml:base"], base) || base : base;
    var out = {
      kind: "atom",
      title: clip(atomTitle(kid(feed, "title")), 300),
      site: linkHref(feed, xb),
      desc: clip(textOf(atomText(kid(feed, "subtitle"))), 500),
      icon: absUrl(kidText(feed, "icon") || kidText(feed, "logo"), xb),
      ttl: 0,
      items: []
    };
    kids(feed, "entry").slice(0, MAX_ITEMS).forEach(function (en) {
      var eb = en.a["xml:base"] ? absUrl(en.a["xml:base"], xb) || xb : xb;
      var link = linkHref(en, eb);
      var content = kid(en, "content"), summary = kid(en, "summary");
      var grp = kid(en, "media:group");
      var html = content && !content.a.src ? atomText(content) : atomText(summary);
      if (!html && grp) html = escHtml(kidText(grp, "media:description")).replace(/\n/g, "<br>");
      var encs = kids(en, "link").filter(function (l) { return (l.a.rel || "") === "enclosure"; })
        .map(function (l) { return { url: l.a.href, type: l.a.type, length: l.a.length }; });
      var au = kid(en, "author") || kid(feed, "author");
      out.items.push(finishItem({
        key: kidText(en, "id") || link,
        title: atomTitle(kid(en, "title")) || (grp ? oneLine(kidText(grp, "media:title")) : ""),
        plain: true,
        link: link,
        date: parseDate(kidText(en, "published") || kidText(en, "updated") || kidText(en, "issued") || kidText(en, "modified")),
        author: au ? (kidText(au, "name") || deepText(au)) : "",
        html: html,
        img: mediaImage(en, eb),
        enc: enclosureOf(encs, eb)
      }, eb));
    });
    return out;
  }

  function parseJsonFeed(j, base) {
    var out = {
      kind: "json",
      title: titleText(j.title),
      site: absUrl(j.home_page_url, base),
      desc: clip(textOf(j.description), 500),
      icon: absUrl(j.icon || j.favicon, base),
      ttl: 0,
      items: []
    };
    var authorOf = function (x) {
      var a = (Array.isArray(x.authors) && x.authors[0]) || x.author;
      return a && typeof a === "object" ? String(a.name || "") : "";
    };
    (Array.isArray(j.items) ? j.items : []).slice(0, MAX_ITEMS).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var html = typeof x.content_html === "string" ? x.content_html :
        (typeof x.content_text === "string" ? escHtml(x.content_text).replace(/\n/g, "<br>") :
          (typeof x.summary === "string" ? escHtml(x.summary) : ""));
      var encs = (Array.isArray(x.attachments) ? x.attachments : []).map(function (a) {
        return a && typeof a === "object" ? { url: a.url, type: a.mime_type, length: a.size_in_bytes } : {};
      });
      out.items.push(finishItem({
        key: x.id !== undefined && x.id !== null ? String(x.id) : x.url,
        title: typeof x.title === "string" ? x.title : "",
        link: typeof x.url === "string" ? x.url : (typeof x.external_url === "string" ? x.external_url : ""),
        date: parseDate(x.date_published || x.date_modified || ""),
        author: authorOf(x) || authorOf(j),
        html: html,
        img: absUrl(x.image || x.banner_image, base),
        enc: enclosureOf(encs, base)
      }, base));
    });
    return out;
  }

  // text → feed object, or null when it is not a feed.
  function parseFeed(text, baseUrl, now) {
    text = String(text || "");
    var head = text.slice(0, 2048).replace(/^\ufeff/, "").trim();
    var out = null;
    if (head[0] === "{") {
      var j = null;
      try { j = JSON.parse(text); } catch (e) { j = null; }
      if (j && typeof j === "object" && /jsonfeed\.org\/version\//.test(String(j.version || "")) ) out = parseJsonFeed(j, baseUrl);
    } else {
      var doc = parseXml(text);
      var rootEl = kids(doc)[0];
      if (rootEl && rootEl.n === "html") rootEl = null;
      if (rootEl) {
        var pm = /^([\w.-]+):/.exec(rootEl.n);
        if (pm && /^(rss|feed|rdf)$/.test(rootEl.n.slice(pm[0].length))) stripPrefix(rootEl, pm[1]);
        if (rootEl.n === "rss" || rootEl.n === "rdf") {
          var ch = kid(rootEl, "channel");
          if (ch) out = parseRss(ch, kids(ch, "item").length ? kids(ch, "item") : kids(rootEl, "item"), baseUrl,
                                 rootEl.n === "rss" ? "rss" : "rdf");
        } else if (rootEl.n === "feed") {
          out = parseAtom(rootEl, baseUrl);
        }
      }
    }
    if (!out) return null;
    // An item dated in the future (bad clock, scheduled post) would stay
    // on top for ever: it counts as published when seen.
    if (now) out.items.forEach(function (it) { if (it.date > now + 86400000) it.date = now; });
    var seen = {};
    out.items = out.items.filter(function (it) {
      if (!it.key || seen[it.key]) return false;
      seen[it.key] = 1;
      return true;
    });
    return out;
  }
  function looksLikeFeed(text) {
    var h = String(text || "").slice(0, 4000).replace(/^\ufeff/, "")
      .replace(/^(\s*(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^\[>]*(\[[\s\S]*?\])?\s*>))+/i, "").trim();
    return /^<(rss|feed|rdf:rdf|[\w-]+:(rss|feed|rdf))\b/i.test(h) ||
           (/^\{/.test(h) && /jsonfeed\.org\/version/.test(h));
  }

  // ---------- 4. Feed discovery ----------
  var FEED_TYPES = /^(application\/(rss|atom|rdf)\+xml|application\/feed\+json|application\/json|text\/xml|application\/xml|application\/x\.atom\+xml|application\/x-rss\+xml)$/i;
  var FEED_HREF = /(\/feeds?\/?$|\/rss\/?$|\/atom\/?$|\.(rss|atom|rdf)$|[\/.](rss|atom|feed)\.(xml|json)$|\/index\.xml$|[?&]feed=(rss2?|atom)|\/feeds\/posts\/default|\/feeds\/videos\.xml)/i;

  function discover(html, pageUrl) {
    html = String(html || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");
    var base = pageUrl, out = [], seen = {};
    var bm = /<base\b([^>]*)>/i.exec(html);
    if (bm) { var ba = parseAttrs(bm[1]); if (ba.href) base = absUrl(ba.href, pageUrl) || pageUrl; }
    function add(url, title, src, rank) {
      var n = normUrl(url);
      if (!n || seen[n]) return;
      seen[n] = 1;
      out.push({ url: n, title: clip(oneLine(title), 200), src: src, rank: rank });
    }
    var re = /<link\b([^>]*)>/gi, m;
    while ((m = re.exec(html))) {
      var a = parseAttrs(m[1]);
      var rel = " " + String(a.rel || "").toLowerCase() + " ";
      var type = String(a.type || "").toLowerCase().split(";")[0].trim();
      if (!a.href || (rel.indexOf(" alternate ") < 0 && rel.indexOf(" feed ") < 0)) continue;
      if (type && !FEED_TYPES.test(type)) continue;
      if (!type && rel.indexOf(" feed ") < 0) continue;
      if (type === "application/json" && !/feed/i.test(a.title || a.href)) continue;
      var u = absUrl(a.href, base);
      var comments = /comment/i.test((a.title || "") + " " + u);
      add(u, a.title || "", "link", comments ? 2 : 0);
    }
    var re2 = /<a\b([^>]*)>([\s\S]{0,300}?)<\/a\s*>/gi, n = 0;
    while ((m = re2.exec(html)) && n < 400) {
      n++;
      var aa = parseAttrs(m[1]);
      if (!aa.href) continue;
      var uu = absUrl(aa.href, base);
      if (!uu || !FEED_HREF.test(uu.replace(/[?#].*$/, "") + (uu.indexOf("?feed=") > 0 ? uu.slice(uu.indexOf("?")) : ""))) continue;
      add(uu, textOf(m[2]) || aa.title || "", "a", 3);
    }
    out.sort(function (x, y) { return x.rank - y.rank; });
    return out.slice(0, 12);
  }

  // Known platforms: the feed address follows from the page address.
  function platformFeeds(pageUrl) {
    var x;
    try { x = new URL(normUrl(pageUrl)); } catch (e) { return []; }
    var host = x.hostname.replace(/^(www|m|old|new)\./, ""), path = x.pathname.replace(/\/+$/, ""), out = [];
    function add(u, title) { var n = normUrl(u); if (n && out.every(function (o) { return o.url !== n; })) out.push({ url: n, title: title || "", src: "rule", rank: 1 }); }
    var seg = path.split("/").filter(Boolean);
    if (/(^|\.)youtube\.com$/.test(host)) {
      if (seg[0] === "channel" && /^UC[\w-]{10,}$/.test(seg[1] || "")) add("https://www.youtube.com/feeds/videos.xml?channel_id=" + seg[1]);
      var list = x.searchParams.get("list");
      if (list && /^[\w-]{10,}$/.test(list)) add("https://www.youtube.com/feeds/videos.xml?playlist_id=" + list);
    } else if (/(^|\.)reddit\.com$/.test(host)) {
      if (/^(r|user|u)$/.test(seg[0] || "") && seg[1]) {
        var p = "/" + (seg[0] === "u" ? "user" : seg[0]) + "/" + seg[1];
        if (seg[2] === "comments" && seg[3]) p += "/comments/" + seg[3];
        add("https://www.reddit.com" + p + "/.rss");
      } else if (!seg.length) add("https://www.reddit.com/.rss");
    } else if (host === "github.com") {
      if (seg.length === 1) add("https://github.com/" + seg[0] + ".atom");
      else if (seg.length >= 2) {
        add("https://github.com/" + seg[0] + "/" + seg[1] + "/releases.atom", "Releases");
        add("https://github.com/" + seg[0] + "/" + seg[1] + "/commits.atom", "Commits");
        add("https://github.com/" + seg[0] + "/" + seg[1] + "/tags.atom", "Tags");
      }
    } else if (host === "medium.com") {
      if (/^@[\w.-]+$/.test(seg[0] || "")) add("https://medium.com/feed/" + seg[0]);
      else if (seg[0] && seg[0] !== "feed") add("https://medium.com/feed/" + seg[0]);
    } else if (/\.medium\.com$/.test(host)) {
      add(x.origin + "/feed");
    } else if (/\.substack\.com$/.test(host)) {
      add(x.origin + "/feed");
    } else if (/\.blogspot\.[a-z.]+$/.test(host)) {
      add(x.origin + "/feeds/posts/default");
    } else if (/\.tumblr\.com$/.test(host)) {
      add(x.origin + "/rss");
    } else if (/\.wordpress\.com$/.test(host)) {
      add(x.origin + (path || "") + "/feed/");
    } else if (host === "bsky.app") {
      if (seg[0] === "profile" && seg[1]) add("https://bsky.app/profile/" + seg[1] + "/rss");
    } else if (host === "vimeo.com") {
      if (seg.length === 1 && /^[\w-]+$/.test(seg[0])) add("https://vimeo.com/" + seg[0] + "/videos/rss");
    } else if (host === "soundcloud.com") {
      // needs the numeric user id: the page's own <link> has it
    }
    // Mastodon (and other ActivityPub servers): https://host/@user
    if (!out.length && seg.length === 1 && /^@[\w.]+$/.test(seg[0])) add(x.origin + "/" + seg[0] + ".rss");
    return out;
  }

  // Last resort: the usual places, on the page's folder and the site root.
  function guessFeeds(pageUrl) {
    var x;
    try { x = new URL(normUrl(pageUrl)); } catch (e) { return []; }
    var dirs = [x.origin];
    var dir = x.pathname.replace(/\/[^\/]*$/, "");
    if (dir && dir !== "/") dirs.unshift(x.origin + dir);
    var tails = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/?feed=rss2", "/feed.json"];
    var out = [];
    dirs.forEach(function (d) {
      tails.forEach(function (t) {
        var n = normUrl(d + t);
        if (n && out.indexOf(n) < 0) out.push(n);
      });
    });
    return out.slice(0, 12);
  }

  // ---------- 5. OPML ----------
  function parseOpml(text) {
    var doc = parseXml(text);
    var opml = kid(doc, "opml");
    var body = opml && kid(opml, "body");
    if (!body) return null;
    var out = [], seen = {};
    (function walk(node, folder, depth) {
      kids(node, "outline").forEach(function (o) {
        var url = o.a.xmlurl || o.a.xmlUrl || o.a.url;
        var name = oneLine(o.a.title || o.a.text || "");
        if (url && (!o.a.type || /^(rss|atom|feed|link)$/i.test(o.a.type) || o.a.xmlurl)) {
          var n = normUrl(url);
          if (n && !seen[n] && out.length < 5000) {
            seen[n] = 1;
            out.push({ url: n, title: clip(name, 200), site: httpUrl(o.a.htmlurl || ""), folder: clip(folder, 60) });
          }
        }
        if (depth < 8) walk(o, url ? folder : (folder || name), depth + 1);
      });
    })(body, "", 0);
    return out;
  }
  function buildOpml(data, title, now) {
    var byFolder = {};
    data.feeds.forEach(function (f) { (byFolder[f.folder] = byFolder[f.folder] || []).push(f); });
    function line(f, ind) {
      return ind + "<outline type=\"rss\" text=\"" + escHtml(f.title) + "\" title=\"" + escHtml(f.title) +
        "\" xmlUrl=\"" + escHtml(f.url) + "\"" + (f.site ? " htmlUrl=\"" + escHtml(f.site) + "\"" : "") + "/>\n";
    }
    var out = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n<head>\n  <title>" + escHtml(title) +
      "</title>\n  <dateCreated>" + new Date(now || 0).toUTCString() + "</dateCreated>\n</head>\n<body>\n";
    sortFolders(data.folders).forEach(function (d) {
      var list = byFolder[d.id] || [];
      out += "  <outline text=\"" + escHtml(d.name) + "\" title=\"" + escHtml(d.name) + "\">\n";
      list.forEach(function (f) { out += line(f, "    "); });
      out += "  </outline>\n";
    });
    data.feeds.forEach(function (f) { if (!f.folder || !folderById(data, f.folder)) out += line(f, "  "); });
    return out + "</body>\n</opml>\n";
  }

  // ---------- 6. Synced data model ----------
  // FEEDS v1 (oros-feeds-data):
  //   feeds   [{ id, url, title, site, folder, img (-1 default | 0 off | 1 on), m }]   sorted by id
  //   folders [{ id, name, ord, m }]                                                   sorted by id
  //   items   [{ id, feed, title, link, date, author, sum, star, later, m }]           saved articles
  //   set     { key: { v, m } }        settings, last writer wins per key
  //   read    { old, cut: { feedId: [date, ts] }, ids: { itemId: [state, ts, date, feedId] } }
  //   tombs   { "f:id" | "d:id" | "i:id": ts }
  // Read state: an article is read when its date is older than `old`
  // (nothing older than KEEP_DAYS is ever unread), or an explicit mark
  // newer than its feed's cut says so, or it is not newer than the cut.
  // Explicit marks the cut already covers are dropped by the merge,
  // which keeps the map small (R26: merge(get, get) === get).
  var DATA_VER = 1;
  var MAX_FEEDS = 2000, MAX_FOLDERS = 200, MAX_SAVED = 2000, MAX_TOMBS = 2000, MAX_READ = 20000;
  var KEEP_DAYS = 60;
  var SETTINGS = {
    refresh: { def: 30, ok: function (v) { return [0, 15, 30, 60, 180].indexOf(v) >= 0; } },
    img: { def: 1, ok: function (v) { return v === 0 || v === 1; } },
    scroll: { def: 0, ok: function (v) { return v === 0 || v === 1; } },
    sort: { def: "new", ok: function (v) { return v === "new" || v === "old"; } },
    relay: { def: "", ok: function (v) { return v === "" || normRelayUrl(v) === v; } }
  };

  function normRelayUrl(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]*)*$/i.test(u) && u.length <= 300) return u;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) return u;   // local relay (development)
    return null;
  }
  function emptyData() { return { ver: DATA_VER, feeds: [], folders: [], items: [], set: {}, read: { old: 0, cut: {}, ids: {} }, tombs: {} }; }
  function okId(id, p) { return typeof id === "string" && new RegExp("^" + p + "[a-z0-9]{6,24}$").test(id); }
  function okM(m) { return isInt(m) && m >= 0; }

  function normFeed(f) {
    if (!f || typeof f !== "object" || !okId(f.id, "f") || !okM(f.m)) return null;
    var url = normUrl(f.url);
    if (!url || feedId(url) !== f.id) return null;
    return {
      id: f.id, url: url,
      title: clip(oneLine(f.title), 200) || siteOf(url),
      site: httpUrl(f.site),
      folder: typeof f.folder === "string" && okId(f.folder, "d") ? f.folder : "",
      img: f.img === 0 || f.img === 1 ? f.img : -1,
      m: f.m
    };
  }
  function normFolder(d) {
    if (!d || typeof d !== "object" || !okId(d.id, "d") || !okM(d.m)) return null;
    var name = clip(oneLine(d.name), 60);
    if (!name) return null;
    return { id: d.id, name: name, ord: isInt(d.ord) ? d.ord : 0, m: d.m };
  }
  function normSaved(x) {
    if (!x || typeof x !== "object" || !okId(x.id, "i") || !okId(x.feed, "f") || !okM(x.m)) return null;
    var star = x.star ? 1 : 0, later = x.later ? 1 : 0;
    if (!star && !later) return null;
    return {
      id: x.id, feed: x.feed,
      title: clip(oneLine(x.title), 300),
      link: httpUrl(x.link),
      date: isInt(x.date) && x.date >= 0 ? x.date : 0,
      author: clip(oneLine(x.author), 120),
      sum: clip(oneLine(x.sum), 2000),
      star: star, later: later, m: x.m
    };
  }
  // Last writer wins; equal stamps: the larger JSON (deterministic).
  function pick(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function sortedKeys(o) { return Object.keys(o).sort(cmpStr); }

  function merge(a, b) {
    var out = emptyData();
    var tombs = {};
    [a, b].forEach(function (d) {
      if (!d || typeof d !== "object" || !d.tombs || typeof d.tombs !== "object") return;
      Object.keys(d.tombs).forEach(function (k) {
        var t = d.tombs[k];
        if (!/^[fdi]:[a-z0-9]{7,25}$/.test(k) || !okM(t)) return;
        if (!(tombs[k] >= t)) tombs[k] = t;
      });
    });
    function collect(field, norm, prefix, max) {
      var by = {};
      [a, b].forEach(function (d) {
        var list = d && Array.isArray(d[field]) ? d[field] : [];
        list.forEach(function (x) {
          var n = norm(x);
          if (n) by[n.id] = pick(by[n.id], n);
        });
      });
      var ids = sortedKeys(by).filter(function (id) {
        var t = tombs[prefix + ":" + id];
        return !(t !== undefined && t >= by[id].m);     // delete wins ties (R17)
      });
      if (ids.length > max) {   // keep the newest
        ids = ids.slice().sort(function (x, y) { return (by[y].m - by[x].m) || cmpStr(x, y); }).slice(0, max).sort(cmpStr);
      }
      return ids.map(function (id) { return by[id]; });
    }
    out.feeds = collect("feeds", normFeed, "f", MAX_FEEDS);
    out.folders = collect("folders", normFolder, "d", MAX_FOLDERS);
    out.items = collect("items", normSaved, "i", MAX_SAVED);

    // settings
    var set = {};
    [a, b].forEach(function (d) {
      var s = d && d.set && typeof d.set === "object" ? d.set : {};
      Object.keys(s).forEach(function (k) {
        var e = s[k];
        if (!SETTINGS[k] || !e || typeof e !== "object" || !okM(e.m) || !SETTINGS[k].ok(e.v)) return;
        set[k] = pick(set[k], { v: e.v, m: e.m });
      });
    });
    sortedKeys(set).forEach(function (k) { out.set[k] = set[k]; });

    // read state
    var live = {};
    out.feeds.forEach(function (f) { live[f.id] = 1; });
    var old = 0, cut = {}, ids = {};
    [a, b].forEach(function (d) {
      var r = d && d.read && typeof d.read === "object" ? d.read : null;
      if (!r) return;
      if (okM(r.old) && r.old > old) old = r.old;
      var c = r.cut && typeof r.cut === "object" ? r.cut : {};
      Object.keys(c).forEach(function (fid) {
        var v = c[fid];
        if (!live[fid] || !Array.isArray(v) || !okM(v[0]) || !okM(v[1])) return;
        var cur = cut[fid];
        cut[fid] = cur ? [Math.max(cur[0], v[0]), Math.max(cur[1], v[1])] : [v[0], v[1]];
      });
      var m = r.ids && typeof r.ids === "object" ? r.ids : {};
      Object.keys(m).forEach(function (id) {
        var v = m[id];
        if (!okId(id, "i") || !Array.isArray(v) || (v[0] !== 0 && v[0] !== 1) || !okM(v[1]) || !okM(v[2]) ||
            typeof v[3] !== "string" || !live[v[3]]) return;
        var cur = ids[id];
        if (!cur || v[1] > cur[1] || (v[1] === cur[1] && (v[0] > cur[0] || (v[0] === cur[0] && (v[2] > cur[2] || (v[2] === cur[2] && v[3] > cur[3]))))))
          ids[id] = [v[0], v[1], v[2], v[3]];
      });
    });
    out.read.old = old;
    sortedKeys(cut).forEach(function (fid) { out.read.cut[fid] = cut[fid]; });
    var keep = sortedKeys(ids).filter(function (id) {
      var v = ids[id], c = cut[v[3]];
      if (v[2] < old) return false;
      if (c && v[1] <= c[1] && v[2] <= c[0]) return false;
      return true;
    });
    if (keep.length > MAX_READ) {
      keep = keep.slice().sort(function (x, y) { return (ids[y][2] - ids[x][2]) || cmpStr(x, y); }).slice(0, MAX_READ).sort(cmpStr);
    }
    keep.forEach(function (id) { out.read.ids[id] = ids[id]; });

    // tombstones: newest MAX_TOMBS, sorted
    var tk = Object.keys(tombs);
    if (tk.length > MAX_TOMBS) tk = tk.sort(function (x, y) { return (tombs[y] - tombs[x]) || cmpStr(x, y); }).slice(0, MAX_TOMBS);
    tk.sort(cmpStr).forEach(function (k) { out.tombs[k] = tombs[k]; });
    return out;
  }

  function setting(data, k) {
    var e = data.set[k];
    return e && SETTINGS[k] && SETTINGS[k].ok(e.v) ? e.v : SETTINGS[k].def;
  }
  function putSetting(data, k, v, now) {
    if (!SETTINGS[k] || !SETTINGS[k].ok(v)) return false;
    var e = data.set[k];
    if (e && e.v === v) return false;
    data.set[k] = { v: v, m: Math.max(now, e ? e.m + 1 : 0) };
    return true;
  }
  function feedById(data, id) {
    for (var i = 0; i < data.feeds.length; i++) if (data.feeds[i].id === id) return data.feeds[i];
    return null;
  }
  function folderById(data, id) {
    for (var i = 0; i < data.folders.length; i++) if (data.folders[i].id === id) return data.folders[i];
    return null;
  }
  function savedById(data, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }
  function sortFolders(list) {
    return list.slice().sort(function (x, y) { return (x.ord - y.ord) || cmpStr(x.name.toLowerCase(), y.name.toLowerCase()) || cmpStr(x.id, y.id); });
  }

  // item: { id, feed, date }
  function isRead(data, it) {
    var r = data.read;
    if (it.date < r.old) return true;
    var e = r.ids[it.id], c = r.cut[it.feed];
    if (e && (!c || e[1] > c[1])) return e[0] === 1;
    if (c && it.date <= c[0]) return true;
    return e ? e[0] === 1 : false;
  }
  // Explicit marks. Stamps only move forward (R27: stamp at the change).
  function markItems(data, list, state, now) {
    var n = 0;
    list.forEach(function (it) {
      if (!feedById(data, it.feed) || isRead(data, it) === (state === 1)) return;
      var e = data.read.ids[it.id];
      var c = data.read.cut[it.feed];
      var ts = Math.max(now, e ? e[1] + 1 : 0, c ? c[1] + 1 : 0);
      data.read.ids[it.id] = [state, ts, Math.max(0, it.date || 0), it.feed];
      n++;
    });
    return n;
  }
  // "Mark all as read" up to a date, for some feeds.
  function markAllBefore(data, feedIds, upTo, now) {
    feedIds.forEach(function (fid) {
      if (!feedById(data, fid)) return;
      var c = data.read.cut[fid];
      var ts = Math.max(now, c ? c[1] + 1 : 0);
      Object.keys(data.read.ids).forEach(function (id) {
        var e = data.read.ids[id];
        if (e[3] === fid && e[1] >= ts) ts = e[1] + 1;
      });
      data.read.cut[fid] = [Math.max(c ? c[0] : 0, upTo), ts];
    });
  }
  // Advance the age line (nothing older than KEEP_DAYS stays unread) and,
  // per feed, move the cut up to the newest article below which every
  // cached article is read: the explicit marks under it then go.
  function compact(data, heads, now) {
    var old = now - KEEP_DAYS * 86400000;
    if (old > data.read.old + 86400000) data.read.old = old;
    var byFeed = {};
    heads.forEach(function (h) { (byFeed[h.feed] = byFeed[h.feed] || []).push(h); });
    Object.keys(byFeed).forEach(function (fid) {
      if (!feedById(data, fid)) return;
      var list = byFeed[fid].slice().sort(function (x, y) { return x.date - y.date; });
      var upTo = 0;
      for (var i = 0; i < list.length; i++) {
        if (!isRead(data, list[i])) break;
        // the next one (if any) must be strictly newer, or the cut would cover it too
        if (i + 1 < list.length && list[i + 1].date === list[i].date) continue;
        upTo = list[i].date;
      }
      var c = data.read.cut[fid];
      var marks = Object.keys(data.read.ids).filter(function (id) { var e = data.read.ids[id]; return e[3] === fid && e[2] <= upTo; });
      if (upTo > (c ? c[0] : 0) && marks.length >= 20) markAllBefore(data, [fid], upTo, now);
    });
  }

  function newId(prefix, now, rnd) {
    var r = (rnd !== undefined ? rnd : Math.random()).toString(36).slice(2, 10);
    while (r.length < 6) r += "0";
    return prefix + (now || 0).toString(36) + r;
  }

  // ---------- 7. Refresh timing ----------
  // state: { fails, ttl } → ms until the next check
  function nextDelay(minutes, state) {
    var base = Math.max(15, minutes || 30) * 60000;
    var ttl = state && state.ttl > 0 ? Math.min(state.ttl, 1440) * 60000 : 0;
    if (ttl > base) base = ttl;
    var fails = state && state.fails > 0 ? Math.min(state.fails, 10) : 0;
    if (fails) base = Math.min(24 * 3600000, Math.max(base, 30 * 60000) * Math.pow(2, fails - 1));
    return base;
  }

  var api = {
    hash: hash, normUrl: normUrl, feedId: feedId, itemId: itemId, absUrl: absUrl, httpUrl: httpUrl, siteOf: siteOf,
    decodeEntities: decodeEntities, escHtml: escHtml, textOf: textOf, titleText: titleText, parseDate: parseDate,
    decodeBytes: decodeBytes, b64ToBytes: b64ToBytes,
    parseXml: parseXml, parseFeed: parseFeed, looksLikeFeed: looksLikeFeed,
    discover: discover, platformFeeds: platformFeeds, guessFeeds: guessFeeds,
    parseOpml: parseOpml, buildOpml: buildOpml,
    DATA_VER: DATA_VER, KEEP_DAYS: KEEP_DAYS, MAX_FEEDS: MAX_FEEDS, MAX_SAVED: MAX_SAVED,
    emptyData: emptyData, merge: merge, normRelayUrl: normRelayUrl, normFeed: normFeed, normSaved: normSaved,
    setting: setting, putSetting: putSetting, feedById: feedById, folderById: folderById, savedById: savedById,
    sortFolders: sortFolders, isRead: isRead, markItems: markItems, markAllBefore: markAllBefore, compact: compact,
    newId: newId, nextDelay: nextDelay
  };
  root.orosFeedsCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
