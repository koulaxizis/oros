// ============================================================
// orOS Layout — EPUB check (v1.0.0, LY-EPUB, wave L7 E2)
// The rules an EPUB most often breaks, checked on the device (the
// official EPUBCheck is Java and does not run in a browser; CI runs it
// on the synthetic books and compares). Works on any EPUB, not only
// Layout's own (More › Check an EPUB…).
//   check(bytes, zip) → Promise<{ errors: [row], warnings: [row],
//                                 info: { version, title, lang, uid,
//                                 files, bytes, fixed } }>
//   row = { c: code, f: file ("" = the whole book), n: detail }
// Codes (strings ep.c.<code> in the app): zip, mime, container, opf,
// xml, meta-title, meta-lang, meta-id, meta-mod, isbn, man-id,
// man-missing, man-type, man-extra, spine, spine-type, nav, nav-toc,
// cover, link, frag, id-dup, svg-prop, remote, script, fxl-vp,
// enc; warnings: no-cover, no-alt, big-file, big-img, big-book,
// no-a11y.
// Pure: no DOM (its own small XML reader, so the same code runs in
// Node). Exposes LY_EPUBCHECK (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_FILES = 10000, MAX_TEXT = 8 * 1024 * 1024;
  var BIG_FILE = 300 * 1024, BIG_IMG = 4e6, BIG_BOOK = 100 * 1024 * 1024;
  var TYPES = {
    xhtml: "application/xhtml+xml", html: "application/xhtml+xml", css: "text/css", js: "text/javascript",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", ncx: "application/x-dtbncx+xml",
    mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", opus: "audio/ogg", smil: "application/smil+xml"
  };
  var FONT_ALIASES = { "application/font-sfnt": 1, "application/x-font-ttf": 1, "application/vnd.ms-opentype": 1, "application/x-font-otf": 1, "application/font-woff": 1, "font/sfnt": 1 };

  // ---------- a small XML reader ----------
  // → { name, attrs: {}, kids: [node | string], parent } tree; throws
  // Error("xml: …") on anything that is not well formed.
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
  function decode(s, at) {
    if (/&(?!#x[0-9a-fA-F]+;|#\d+;|[A-Za-z][A-Za-z0-9]*;)/.test(s)) throw new Error("xml: bare & near " + at);
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);?/g, function (m, e) {
      if (m[m.length - 1] !== ";") throw new Error("xml: bare & near " + at);
      if (e[0] === "#") {
        var n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(n >= 1 && n <= 0x10FFFF)) throw new Error("xml: bad character reference");
        return String.fromCodePoint(n);
      }
      if (!(e in ENT)) throw new Error("xml: unknown entity &" + e + ";");
      return ENT[e];
    });
  }
  function parseXml(src) {
    var i = 0, n = src.length, rootNode = null, stack = [], doc = { name: "#doc", attrs: {}, kids: [] };
    if (src.charCodeAt(0) === 0xFEFF) i = 1;
    var cur = doc;
    function err(m) { throw new Error("xml: " + m + " at " + i); }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt < 0) lt = n;
      if (lt > i) {
        var txt = src.slice(i, lt);
        if (cur === doc) { if (/\S/.test(txt)) err("text outside the root"); }
        else cur.kids.push(decode(txt, i));
        i = lt;
        if (i >= n) break;
      }
      if (src.startsWith("<!--", i)) { var e1 = src.indexOf("-->", i + 4); if (e1 < 0) err("open comment"); i = e1 + 3; continue; }
      if (src.startsWith("<?", i)) { var e2 = src.indexOf("?>", i + 2); if (e2 < 0) err("open processing instruction"); i = e2 + 2; continue; }
      if (src.startsWith("<![CDATA[", i)) { var e3 = src.indexOf("]]>", i + 9); if (e3 < 0) err("open CDATA"); if (cur !== doc) cur.kids.push(src.slice(i + 9, e3)); i = e3 + 3; continue; }
      if (src.startsWith("<!DOCTYPE", i) || src.startsWith("<!doctype", i)) {
        if (rootNode) err("DOCTYPE after the root");
        var e4 = src.indexOf(">", i), br = src.indexOf("[", i);
        if (br >= 0 && br < e4) e4 = src.indexOf("]>", br) + 1;
        if (e4 <= 0) err("open DOCTYPE");
        i = e4 + 1; continue;
      }
      if (src[i + 1] === "/") {
        var m = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(src.slice(i, i + 300));
        if (!m) err("bad end tag");
        if (cur === doc || cur.name !== m[1]) err("end tag </" + m[1] + "> does not match <" + cur.name + ">");
        cur = stack.pop();
        i += m[0].length;
        continue;
      }
      var mt = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(i, i + 300));
      if (!mt) err("bad tag");
      var node = { name: mt[1], attrs: {}, kids: [], parent: cur };
      i += mt[0].length;
      for (;;) {
        var ws = /^\s*/.exec(src.slice(i, i + 200))[0];
        i += ws.length;
        if (src[i] === ">") { i++; break; }
        if (src[i] === "/" && src[i + 1] === ">") { i += 2; node.selfClosed = true; break; }
        if (!ws) err("attributes need a space between them");
        var ma = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(src.slice(i, i + 65536));
        if (!ma) err("bad attribute in <" + node.name + ">");
        if (ma[1] in node.attrs) err("attribute " + ma[1] + " twice in <" + node.name + ">");
        node.attrs[ma[1]] = decode(ma[3] !== undefined ? ma[3] : ma[4], i);
        i += ma[0].length;
      }
      if (cur === doc) { if (rootNode) err("two root elements"); rootNode = node; }
      cur.kids.push(node);
      if (!node.selfClosed) { stack.push(cur); cur = node; }
    }
    if (cur !== doc) throw new Error("xml: <" + cur.name + "> is never closed");
    if (!rootNode) throw new Error("xml: no root element");
    return rootNode;
  }
  function local(name) { var k = name.indexOf(":"); return k < 0 ? name : name.slice(k + 1); }
  function walk(node, fn) {
    fn(node);
    node.kids.forEach(function (k) { if (typeof k !== "string") walk(k, fn); });
  }
  function all(node, lname) { var out = []; walk(node, function (x) { if (local(x.name) === lname) out.push(x); }); return out; }
  function textOf(node) { var s = ""; walk(node, function (x) { x.kids.forEach(function (k) { if (typeof k === "string") s += k; }); }); return s; }

  // ---------- paths ----------
  function dirOf(p) { var k = p.lastIndexOf("/"); return k < 0 ? "" : p.slice(0, k + 1); }
  function resolve(base, href) {
    var parts = (dirOf(base) + href).split("/"), out = [];
    parts.forEach(function (s) { if (s === "..") out.pop(); else if (s !== "." && s !== "") out.push(s); });
    return out.join("/");
  }
  function unesc(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }
  function extOf(p) { var m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ""; }

  function isbnOk(s) {
    if (!/^\d{13}$/.test(s || "")) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
    return (10 - sum % 10) % 10 === +s[12];
  }
  // width × height of a PNG / JPEG / GIF, or null
  function imgSize(b) {
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 };
    if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8) {
      var i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        var mk = b[i + 1], len = b[i + 2] << 8 | b[i + 3];
        if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { h: b[i + 5] << 8 | b[i + 6], w: b[i + 7] << 8 | b[i + 8] };
        i += 2 + len;
      }
    }
    return null;
  }

  function check(bytes, Z) {
    var errors = [], warnings = [], info = { version: "", title: "", lang: "", uid: "", files: 0, bytes: bytes.length, fixed: false };
    function E(c, f, n) { errors.push({ c: c, f: f || "", n: n === undefined ? "" : String(n).slice(0, 300) }); }
    function W(c, f, n) { warnings.push({ c: c, f: f || "", n: n === undefined ? "" : String(n).slice(0, 300) }); }
    function done() { return { errors: errors, warnings: warnings, info: info }; }
    var z;
    try { z = Z.open(bytes); } catch (e) { E("zip"); return Promise.resolve(done()); }
    info.files = z.names.length;
    if (z.names.length > MAX_FILES) { E("zip", "", z.names.length); return Promise.resolve(done()); }
    if (bytes.length > BIG_BOOK) W("big-book", "", bytes.length);
    // mimetype: the first entry, stored, no extra field, exact content
    var u16 = function (o) { return bytes[o] | bytes[o + 1] << 8; };
    var nameLen = u16(26), extra = u16(28), first = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen));
    var mimeBody = new TextDecoder().decode(bytes.subarray(30 + nameLen + extra, 30 + nameLen + extra + 20));
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 3 && bytes[3] === 4) || first !== "mimetype" || u16(8) !== 0 || extra !== 0 || mimeBody !== "application/epub+zip") E("mime");
    var have = {};
    z.names.forEach(function (nm) { have[nm] = 1; });
    var xmlCache = {};
    function readXml(name) {
      if (xmlCache[name] !== undefined) return Promise.resolve(xmlCache[name]);
      return z.text(name, MAX_TEXT).then(function (s) {
        var r = null;
        try { r = parseXml(s || ""); } catch (e) { E("xml", name, e.message); }
        xmlCache[name] = r;
        return r;
      }, function () { E("xml", name, "read"); xmlCache[name] = null; return null; });
    }
    if (!have["META-INF/container.xml"]) { E("container"); return Promise.resolve(done()); }
    var opfPath = "", opfDoc = null, man = {}, manByPath = {}, spine = [], navPath = "";
    return readXml("META-INF/container.xml").then(function (c) {
      if (!c) return null;
      var rf = all(c, "rootfile").filter(function (r) { return r.attrs["media-type"] === "application/oebps-package+xml"; })[0];
      opfPath = rf ? rf.attrs["full-path"] || "" : "";
      if (!opfPath || !have[opfPath]) { E("container", "", opfPath); return null; }
      return readXml(opfPath);
    }).then(function (pkg) {
      if (!pkg) { if (opfPath && have[opfPath] && !errors.some(function (r) { return r.c === "xml"; })) E("opf"); return null; }
      opfDoc = pkg;
      if (local(pkg.name) !== "package") { E("opf", opfPath); return null; }
      info.version = pkg.attrs.version || "";
      var md = all(pkg, "metadata")[0];
      if (!md) { E("opf", opfPath, "metadata"); return null; }
      var titles = md.kids.filter(function (k) { return typeof k !== "string" && local(k.name) === "title" && textOf(k).trim(); });
      if (!titles.length) E("meta-title", opfPath); else info.title = textOf(titles[0]).trim();
      var langs = md.kids.filter(function (k) { return typeof k !== "string" && local(k.name) === "language" && textOf(k).trim(); });
      if (!langs.length) E("meta-lang", opfPath); else info.lang = textOf(langs[0]).trim();
      var uidRef = pkg.attrs["unique-identifier"];
      var ids = md.kids.filter(function (k) { return typeof k !== "string" && local(k.name) === "identifier"; });
      var uid = ids.filter(function (k) { return k.attrs.id === uidRef; })[0];
      if (!uid || !textOf(uid).trim()) E("meta-id", opfPath);
      else {
        info.uid = textOf(uid).trim();
        var mi = /^urn:isbn:([\d-]+)$/i.exec(info.uid);
        if (mi && !isbnOk(mi[1].replace(/-/g, ""))) E("isbn", opfPath, mi[1]);
      }
      var metas = md.kids.filter(function (k) { return typeof k !== "string" && local(k.name) === "meta"; });
      var prop = function (p) { return metas.filter(function (k) { return k.attrs.property === p && !k.attrs.refines; }).map(function (k) { return textOf(k).trim(); }); };
      if (info.version.indexOf("3") === 0) {
        var mod = prop("dcterms:modified");
        if (mod.length !== 1 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(mod[0])) E("meta-mod", opfPath, mod[0] || "");
        if (!prop("schema:accessMode").length || !prop("schema:accessibilityFeature").length) W("no-a11y", opfPath);
        info.fixed = prop("rendition:layout")[0] === "pre-paginated";
      }
      // manifest
      var items = all(pkg, "item"), coverN = 0, navN = 0;
      items.forEach(function (it) {
        var id = it.attrs.id, href = it.attrs.href, type = it.attrs["media-type"] || "", props = (it.attrs.properties || "").split(/\s+/);
        if (!id || man[id]) { E("man-id", opfPath, id || ""); return; }
        if (!href) { E("man-missing", opfPath, id); return; }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { if (!/^audio|^video/.test(type)) E("remote", opfPath, href); return; }
        var p = resolve(opfPath, unesc(href.split("#")[0]));
        man[id] = { id: id, path: p, type: type, props: props };
        manByPath[p] = man[id];
        if (!have[p]) E("man-missing", opfPath, href);
        var want = TYPES[extOf(p)];
        if (want && type !== want && !(FONT_ALIASES[type] && /^font\//.test(want)) && !(want === "text/javascript" && type === "application/javascript")) E("man-type", p, type + " → " + want);
        if (props.indexOf("cover-image") >= 0) { coverN++; if (!/^image\//.test(type)) E("cover", p); }
        if (props.indexOf("nav") >= 0) { navN++; navPath = p; if (type !== "application/xhtml+xml") E("nav", p); }
      });
      if (info.version.indexOf("3") === 0) {
        if (navN !== 1) E("nav", opfPath, navN);
        if (coverN > 1) E("cover", opfPath, coverN);
        if (!coverN) W("no-cover", opfPath);
      }
      z.names.forEach(function (nm) {
        if (nm === "mimetype" || nm.indexOf("META-INF/") === 0 || nm === opfPath || /\/$/.test(nm)) return;
        if (!manByPath[nm]) W("man-extra", nm);
      });
      all(pkg, "itemref").forEach(function (r) {
        var m = man[r.attrs.idref];
        if (!m) { E("spine", opfPath, r.attrs.idref || ""); return; }
        if (m.type !== "application/xhtml+xml" && m.type !== "image/svg+xml") E("spine-type", m.path, m.type);
        spine.push(m);
      });
      if (!spine.length) E("spine", opfPath, 0);
      return null;
    }).then(function () {
      if (!opfDoc) return done();
      // every XHTML: well formed, ids, links, pictures
      var pages = Object.keys(man).map(function (k) { return man[k]; }).filter(function (m) { return m.type === "application/xhtml+xml" && have[m.path]; });
      var idsOf = {}, links = [], chain = Promise.resolve();
      pages.forEach(function (m) {
        chain = chain.then(function () {
          return z.bytes(m.path, MAX_TEXT).then(function (b) {
            if (b && b.length > BIG_FILE) W("big-file", m.path, b.length);
            return readXml(m.path);
          }, function () { return readXml(m.path); });
        }).then(function (x) {
          if (!x) return;
          var seen = {}, hasSvg = false, hasScript = false;
          walk(x, function (el) {
            var nm = local(el.name), a = el.attrs;
            if (a.id) { if (seen[a.id]) E("id-dup", m.path, a.id); seen[a.id] = 1; }
            if (nm === "svg") hasSvg = true;
            if (nm === "script") hasScript = true;
            if (nm === "img") {
              // EPUBCheck accepts a picture without alt; a reader of the
              // screen does not, so it is a warning here too
              if (!a.alt && a.role !== "presentation" && a.role !== "none") W("no-alt", m.path, a.src || "");
            }
            var refs = [];
            if (nm === "a" && a.href) refs.push(a.href);
            if ((nm === "img" || nm === "source" || nm === "audio" || nm === "video") && a.src) refs.push(a.src);
            if (nm === "link" && a.href) refs.push(a.href);
            if (nm === "image" && (a["xlink:href"] || a.href)) refs.push(a["xlink:href"] || a.href);
            refs.forEach(function (h) { links.push({ from: m.path, href: h, nav: nm === "a" }); });
            if (nm === "meta" && a.name === "viewport") m.vp = a.content || "";
          });
          idsOf[m.path] = seen;
          if (hasSvg && m.props.indexOf("svg") < 0) E("svg-prop", m.path);
          if (hasScript && m.props.indexOf("scripted") < 0) E("script", m.path);
          if (info.fixed && spine.indexOf(m) >= 0 && m.props.indexOf("nav") < 0 && !/width\s*=\s*\d+/.test(m.vp || "")) E("fxl-vp", m.path);
          if (m.path === navPath) {
            var toc = all(x, "nav").filter(function (n) { return /(^|\s)toc(\s|$)/.test(n.attrs["epub:type"] || ""); })[0];
            if (!toc || !all(toc, "li").length) E("nav-toc", m.path);
          }
        });
      });
      return chain.then(function () {
        links.forEach(function (l) {
          if (/^[a-z][a-z0-9+.-]*:/i.test(l.href)) {
            if (!l.nav && /^https?:/i.test(l.href)) E("remote", l.from, l.href);
            return;
          }
          var parts = l.href.split("#"), target = parts[0] ? resolve(l.from, unesc(parts[0])) : l.from;
          if (!have[target]) { E("link", l.from, l.href); return; }
          if (!manByPath[target]) E("link", l.from, l.href);
          if (parts[1] && idsOf[target] && !idsOf[target][unesc(parts[1])]) E("frag", l.from, l.href);
        });
        // pictures larger than 4 megapixels
        var imgs = Object.keys(man).map(function (k) { return man[k]; }).filter(function (m) { return /^image\/(png|jpeg|gif)$/.test(m.type) && have[m.path]; });
        var c2 = Promise.resolve();
        imgs.forEach(function (m) {
          c2 = c2.then(function () { return z.bytes(m.path, 64 * 1024 * 1024); }).then(function (b) {
            var s = b && imgSize(b);
            if (s && s.w * s.h > BIG_IMG) W("big-img", m.path, s.w + "×" + s.h);
          }, function () {});
        });
        return c2;
      }).then(function () {
        if (!have["META-INF/encryption.xml"]) return null;
        return readXml("META-INF/encryption.xml").then(function (x) {
          if (!x) return;
          all(x, "CipherReference").forEach(function (r) { if (!have[unesc(r.attrs.URI || "")]) E("enc", "META-INF/encryption.xml", r.attrs.URI); });
        });
      }).then(done);
    });
  }

  var api = { check: check, parseXml: parseXml, isbnOk: isbnOk, imgSize: imgSize, resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_EPUBCHECK = api;
})(typeof window !== "undefined" ? window : this);
