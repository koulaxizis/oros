// ============================================================
// orOS Library — EPUB chapter sanitizer (v1.0.0)
// First wall. A chapter (XHTML from inside the EPUB) is parsed in an
// INERT document (DOMParser: no scripts run, nothing loads) and
// rebuilt from an allowlist of elements and attributes:
//   - no script, style element, link, iframe, object, embed, form,
//     input, button, audio, video, canvas, meta, base; no event
//     attributes; no URL attribute survives as a URL:
//       <a href>   → data-lh (a place inside the book: "path#frag")
//                    or data-lx (http(s) / mailto, opened by the app
//                    only after asking)
//       <img src>  → data-ls (a file inside the ZIP); the reader
//                    turns it into a blob: URL of that file
//   - SVG is never inlined: an <svg> holding an <image> becomes an
//     <img> of that picture (covers), any other SVG is dropped.
//   - the book's CSS (<link rel=stylesheet> + <style>) is collected,
//     then cleaned by css(): no @import, no url() except the book's
//     own files as blob: URLs, no expression(), behavior, bindings,
//     no fixed / sticky positioning.
// Second wall: the reader shows the result in an iframe whose
// document starts with a Content-Security-Policy "default-src
// 'none'" (no script of any kind can run, nothing loads from the
// network). Either wall alone must hold.
// Offsets: text() / textNodes() define "the chapter's text" — every
// Text node under the root, in document order. Locations and
// highlights count characters in it (core.js "e:<spine>:<offset>").
// Exposes window.LibSanitize.
// ============================================================
(function () {
  "use strict";

  var C = window.LibCore;
  var ROOT_ID = "__lib_root";
  var DROP = {
    script: 1, noscript: 1, template: 1, style: 1, link: 1, meta: 1, base: 1, title: 1, head: 1,
    iframe: 1, frame: 1, frameset: 1, object: 1, embed: 1, applet: 1, param: 1, form: 1, input: 1,
    button: 1, textarea: 1, select: 1, option: 1, optgroup: 1, datalist: 1, output: 1, canvas: 1,
    audio: 1, video: 1, source: 1, track: 1, dialog: 1, portal: 1, map: 1, area: 1, picture: 0,
    xml: 1, "switch": 0
  };
  var KEEP = {
    a: 1, abbr: 1, address: 1, article: 1, aside: 1, b: 1, bdi: 1, bdo: 1, big: 1, blockquote: 1, br: 1,
    caption: 1, center: 1, cite: 1, code: 1, col: 1, colgroup: 1, dd: 1, del: 1, details: 1, dfn: 1,
    div: 1, dl: 1, dt: 1, em: 1, figcaption: 1, figure: 1, footer: 1, h1: 1, h2: 1, h3: 1, h4: 1,
    h5: 1, h6: 1, header: 1, hgroup: 1, hr: 1, i: 1, img: 1, ins: 1, kbd: 1, li: 1, main: 1, mark: 1,
    nav: 1, ol: 1, p: 1, pre: 1, q: 1, rb: 1, rp: 1, rt: 1, rtc: 1, ruby: 1, s: 1, samp: 1, section: 1,
    small: 1, span: 1, strike: 1, strong: 1, sub: 1, summary: 1, sup: 1, table: 1, tbody: 1, td: 1,
    tfoot: 1, th: 1, thead: 1, time: 1, tr: 1, tt: 1, u: 1, ul: 1, "var": 1, wbr: 1
  };
  var TEXT_ATTRS = { lang: 1, dir: 1, title: 1, alt: 1, colspan: 1, rowspan: 1, start: 1, reversed: 1,
                     scope: 1, headers: 1, datetime: 1, value: 1, span: 1, align: 1 };

  function cleanValue(v) { return String(v || "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim(); }

  // ---------- CSS ----------
  // url(...) → resolve(path) (a blob: URL) or dropped; everything that
  // can run, load or escape the page is cut.
  function css(text, base, resolve) {
    text = String(text || "");
    if (text.length > 1024 * 1024) text = text.slice(0, 1024 * 1024);
    text = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    text = text.replace(/@import[^;]*;?/gi, " ").replace(/@charset[^;]*;?/gi, " ").replace(/@namespace[^;]*;?/gi, " ");
    text = text.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, function (all, q, u) {
      var rp = C.resolvePath(base, cleanValue(u));
      var b = rp && resolve ? resolve(rp.path) : "";
      return b && /^blob:/.test(b) ? "url(\"" + b + "\")" : "none";
    });
    text = text.replace(/expression\s*\(/gi, "x(").replace(/javascript\s*:/gi, "x:")
               .replace(/-moz-binding|behavior\s*:/gi, "x-blocked:")
               .replace(/position\s*:\s*(fixed|sticky)/gi, "position: static")
               .replace(/<\/?style/gi, "");
    return text;
  }
  function inlineStyle(v) {
    v = cleanValue(v).slice(0, 2000);
    if (/url\s*\(|expression|javascript|binding|behavior|@import|\\/i.test(v)) {
      v = v.split(";").filter(function (d) { return !/url\s*\(|expression|javascript|binding|behavior|@import|\\/i.test(d); }).join(";");
    }
    return v.replace(/position\s*:\s*(fixed|sticky)/gi, "position: static");
  }

  // ---------- Parse ----------
  function parse(text) {
    text = String(text || "");
    var doc = null;
    try {
      doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
      if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) doc = null;
    } catch (e) { doc = null; }
    if (!doc) doc = new DOMParser().parseFromString(text, "text/html");
    return doc;
  }
  function local(n) { return String(n.localName || n.nodeName || "").toLowerCase(); }
  function attrLocal(a) { return String(a.localName || a.name || "").toLowerCase(); }
  function hrefOf(n) {
    return n.getAttribute("href") || n.getAttributeNS("http://www.w3.org/1999/xlink", "href") || n.getAttribute("xlink:href") || "";
  }

  // prepare(text, base) → { doc, body, css: [paths], styles: [text],
  //   imgs: [paths], bodyClass, lang, dir }
  // The reader loads css/imgs from the ZIP, then calls build().
  function prepare(text, base) {
    var doc = parse(text);
    var out = { doc: doc, css: [], styles: [], imgs: [], bodyClass: "", lang: "", dir: "" };
    var all = doc.getElementsByTagName("*");
    for (var i = 0; i < all.length && i < 200000; i++) {
      var n = all[i], l = local(n);
      if (l === "link" && /stylesheet/i.test(n.getAttribute("rel") || "")) {
        var rp = C.resolvePath(base, n.getAttribute("href"));
        if (rp && out.css.indexOf(rp.path) < 0) out.css.push(rp.path);
      } else if (l === "style") {
        out.styles.push(n.textContent || "");
      } else if (l === "img" || l === "image") {
        var src = l === "img" ? n.getAttribute("src") : hrefOf(n);
        var ip = C.resolvePath(base, src);
        if (ip && out.imgs.indexOf(ip.path) < 0) out.imgs.push(ip.path);
      }
    }
    var body = doc.body || doc.getElementsByTagName("body")[0] || doc.documentElement;
    out.body = body;
    if (body && body.getAttribute) {
      out.bodyClass = cleanValue(body.getAttribute("class")).slice(0, 200);
      out.dir = /^(ltr|rtl)$/i.test(body.getAttribute("dir") || "") ? body.getAttribute("dir").toLowerCase() : "";
    }
    var html = doc.documentElement;
    if (html && html.getAttribute) {
      var lg = html.getAttribute("xml:lang") || html.getAttribute("lang") || "";
      if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lg)) out.lang = lg;
    }
    return out;
  }

  // build(prep, base, res) → html string of the cleaned body content.
  // res(path) → blob: URL for a file of the ZIP (or "").
  function build(prep, base, res) {
    var doc = document.implementation.createHTMLDocument("");
    var box = doc.createElement("div");
    copy(prep.body, box, doc, base, res, 0);
    return box.innerHTML;
  }

  function copy(src, out, doc, base, res, depth) {
    if (!src || depth > 80) return;
    for (var c = src.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 4) { out.appendChild(doc.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      var tag = local(c);
      if (tag === "svg") { svgImage(c, out, doc, base, res); continue; }
      if (tag === "math") { out.appendChild(doc.createTextNode(c.textContent || "")); continue; }
      if (DROP[tag]) continue;
      if (!KEEP[tag]) { copy(c, out, doc, base, res, depth + 1); continue; }
      var n = doc.createElement(tag === "center" ? "div" : tag === "big" || tag === "tt" || tag === "strike" ? "span" : tag);
      if (tag === "center") n.setAttribute("style", "text-align:center");
      if (tag === "strike") n.setAttribute("style", "text-decoration:line-through");
      for (var i = 0; i < c.attributes.length; i++) {
        var a = c.attributes[i], name = attrLocal(a), full = String(a.name || "").toLowerCase();
        var v = a.value;
        if (/^on/.test(name)) continue;
        if (name === "id") {
          v = cleanValue(v).slice(0, 200);
          if (v && v.indexOf("__lib") !== 0) n.setAttribute("id", v);
        } else if (name === "class") {
          v = cleanValue(v).slice(0, 200);
          if (v && !/(^|\s)lib-/.test(v)) n.setAttribute("class", v);
        } else if (name === "lang" && (full === "xml:lang" || full === "lang")) {
          v = cleanValue(v);
          if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(v)) n.setAttribute("lang", v);
        } else if ((name === "type" && full !== "type") || name === "epub:type") {   // epub:type (XHTML or HTML parse)
          n.setAttribute("data-et", cleanValue(v).slice(0, 100));
        } else if (name === "style") {
          var st = inlineStyle(v);
          if (st) n.setAttribute("style", (n.getAttribute("style") ? n.getAttribute("style") + ";" : "") + st);
        } else if (name === "href" && tag === "a") {
          link(n, v, base);
        } else if (name === "src" && tag === "img") {
          var rp = C.resolvePath(base, v);
          var u = rp && res ? res(rp.path) : "";
          if (u && /^blob:/.test(u)) n.setAttribute("src", u);
          n.setAttribute("data-ls", rp ? rp.path : "");
        } else if ((name === "width" || name === "height") && tag === "img") {
          if (/^\d{1,5}(px|%)?$/.test(cleanValue(v))) n.setAttribute(name, cleanValue(v));
        } else if (TEXT_ATTRS[name] && full === name) {
          n.setAttribute(name, cleanValue(v).slice(0, 500));
        }
      }
      if (tag === "img") {
        if (!n.getAttribute("src")) {
          var alt = n.getAttribute("alt");
          if (alt) out.appendChild(doc.createTextNode(alt));
          continue;
        }
        n.setAttribute("decoding", "async");
      }
      if (tag === "a") { n.setAttribute("role", "link"); n.setAttribute("tabindex", "0"); }
      copy(c, n, doc, base, res, depth + 1);
      out.appendChild(n);
    }
  }
  function link(n, v, base) {
    v = cleanValue(v).replace(/\s+/g, "");
    if (/^(https?:|mailto:)/i.test(v)) {
      try {
        var u = new URL(v);
        if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") n.setAttribute("data-lx", u.href.slice(0, 2000));
      } catch (e) { /* drop */ }
      return;
    }
    var rp = C.resolvePath(base, v);
    if (rp) n.setAttribute("data-lh", (rp.path + (rp.frag ? "#" + rp.frag : "")).slice(0, 1000));
  }
  function svgImage(svg, out, doc, base, res) {
    var imgs = svg.getElementsByTagNameNS ? svg.getElementsByTagNameNS("*", "image") : [];
    if (!imgs.length) return;
    var rp = C.resolvePath(base, hrefOf(imgs[0]));
    var u = rp && res ? res(rp.path) : "";
    if (!u || !/^blob:/.test(u)) return;
    var n = doc.createElement("img");
    n.setAttribute("src", u);
    n.setAttribute("data-ls", rp.path);
    n.setAttribute("class", "lib-svgimg");
    n.setAttribute("alt", "");
    out.appendChild(n);
  }

  // ---------- The chapter's text ----------
  function textNodes(root) {
    var out = [], doc = root.ownerDocument;
    var w = doc.createTreeWalker(root, 4, null);
    var n, at = 0;
    while ((n = w.nextNode())) { out.push({ n: n, s: at }); at += n.nodeValue.length; }
    out.total = at;
    return out;
  }
  // Same tree the reader's iframe will hold (same string, same parser).
  function wrap(html) { return "<div id=\"" + ROOT_ID + "\">" + html + "</div>"; }
  function textOf(html) {
    var d = new DOMParser().parseFromString("<!doctype html><html><body>" + wrap(html) + "</body></html>", "text/html");
    var r = d.getElementById(ROOT_ID);
    return { doc: d, root: r, text: r ? r.textContent : "" };
  }

  window.LibSanitize = { ROOT_ID: ROOT_ID, prepare: prepare, build: build, css: css, wrap: wrap,
                         textNodes: textNodes, textOf: textOf, inlineStyle: inlineStyle };
})();
