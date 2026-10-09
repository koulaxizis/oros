// ============================================================
// orOS Reader — article sanitizer (first wall)
// Same contract as the Mail sanitizer: the article is parsed in an
// INERT document (DOMParser: no scripts run, nothing loads) and
// rebuilt from an allowlist of tags, attributes and URL schemes.
// The result is shown in a sandboxed iframe (no scripts, opaque
// origin, CSP): the second wall (feeds.js, renderArticle). Either
// wall alone must hold.
// Reader mode: no author styles at all (no style attribute, no
// <style>, no colours or fonts), so every article reads the same
// in the skin's colours.
//
// window.orosFeedsSanitize(html, { base: url, images: bool })
//   -> { html, blocked }   blocked = pictures left out (images off)
// ============================================================
(function () {
  "use strict";

  var DROP = {
    SCRIPT: 1, NOSCRIPT: 1, TEMPLATE: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1, APPLET: 1,
    FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, LINK: 1, META: 1, BASE: 1,
    TITLE: 1, STYLE: 1, SVG: 1, MATH: 1, CANVAS: 1, DIALOG: 1, PORTAL: 1, MAP: 1, AREA: 1,
    HEAD: 1, PARAM: 1, XML: 1, TRACK: 1
  };
  var KEEP = {
    A: 1, ABBR: 1, ADDRESS: 1, ARTICLE: 1, ASIDE: 1, AUDIO: 1, B: 1, BDI: 1, BDO: 1, BLOCKQUOTE: 1,
    BR: 1, CAPTION: 1, CITE: 1, CODE: 1, COL: 1, COLGROUP: 1, DD: 1, DEL: 1, DETAILS: 1, DFN: 1,
    DIV: 1, DL: 1, DT: 1, EM: 1, FIGCAPTION: 1, FIGURE: 1, FOOTER: 1, H1: 1, H2: 1, H3: 1, H4: 1,
    H5: 1, H6: 1, HEADER: 1, HR: 1, I: 1, IMG: 1, INS: 1, KBD: 1, LI: 1, MAIN: 1, MARK: 1, OL: 1,
    P: 1, PRE: 1, Q: 1, RP: 1, RT: 1, RUBY: 1, S: 1, SAMP: 1, SECTION: 1, SMALL: 1, SOURCE: 1,
    SPAN: 1, STRONG: 1, SUB: 1, SUMMARY: 1, SUP: 1, TABLE: 1, TBODY: 1, TD: 1, TFOOT: 1, TH: 1,
    THEAD: 1, TIME: 1, TR: 1, U: 1, UL: 1, VAR: 1, VIDEO: 1, WBR: 1
  };
  // Per attribute: 1 = copy as text, 2 = URL
  var ATTRS = {
    dir: 1, lang: 1, title: 1, alt: 1, colspan: 1, rowspan: 1, start: 1, reversed: 1, scope: 1,
    headers: 1, datetime: 1, cite: 2, href: 2, src: 2, poster: 2, type: 1, open: 1
  };
  var MEDIA_ONLY = { src: { IMG: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1 }, poster: { VIDEO: 1 }, href: { A: 1 },
                     cite: { BLOCKQUOTE: 1, Q: 1, DEL: 1, INS: 1 }, type: { SOURCE: 1, OL: 1 }, open: { DETAILS: 1 } };
  var IMG_DATA = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
  var TRACKER = /(feeds\.feedburner\.com\/~r\/|feedsportal\.com|stats\.wordpress\.com|\/pixel(\.gif|\.png|\?)|\/1x1\.|doubleclick\.net|google-analytics\.com|\/blank\.gif)/i;
  var EMBEDS = [
    { re: /^https?:\/\/(www\.)?(youtube(-nocookie)?\.com\/embed\/|youtube\.com\/v\/)([\w-]{6,})/i, url: function (m) { return "https://www.youtube.com/watch?v=" + m[4]; }, name: "YouTube" },
    { re: /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i, url: function (m) { return "https://vimeo.com/" + m[1]; }, name: "Vimeo" },
    { re: /^https?:\/\/(www\.)?dailymotion\.com\/embed\/video\/(\w+)/i, url: function (m) { return "https://www.dailymotion.com/video/" + m[2]; }, name: "Dailymotion" },
    { re: /^https?:\/\/open\.spotify\.com\/embed\/(.+)$/i, url: function (m) { return "https://open.spotify.com/" + m[1]; }, name: "Spotify" }
  ];

  function abs(u, base) {
    try {
      var x = new URL(u, base || undefined);
      return (x.protocol === "https:" || x.protocol === "http:") ? x.href : "";
    } catch (e) { return ""; }
  }
  function cleanValue(v) { return String(v || "").replace(/[\u0000-\u0020\u007f-\u009f]+/g, " ").trim(); }

  function cleanUrl(name, value, tag, ctx) {
    var v = cleanValue(value).replace(/\s+/g, "");
    if (name === "href" || name === "cite") {
      if (/^mailto:/i.test(v)) return name === "href" ? v : null;
      if (/^#/.test(v)) return null;                    // in-page anchors go nowhere in the frame
      return abs(v, ctx.base) || null;
    }
    // src / poster
    if (tag === "IMG" || name === "poster") {
      if (IMG_DATA.test(v)) return v;
      var u = abs(v, ctx.base);
      if (!u || TRACKER.test(u)) return null;
      if (!ctx.images) { ctx.blocked++; return null; }
      return u;
    }
    return abs(v, ctx.base) || null;                    // AUDIO / VIDEO / SOURCE
  }

  // Lazy-loading themes put the real picture in data-src.
  function realSrc(c) {
    var lazy = c.getAttribute("data-src") || c.getAttribute("data-lazy-src") || c.getAttribute("data-original");
    var src = c.getAttribute("src") || "";
    if (lazy && (!src || /^data:/i.test(src) || /lazy|placeholder|blank|spacer/i.test(src))) return lazy;
    if (!src) {
      var set = c.getAttribute("srcset") || c.getAttribute("data-srcset") || "";
      var first = set.split(",")[0];
      if (first) return first.trim().split(/\s+/)[0];
    }
    return src;
  }
  function tiny(c) {
    var w = parseInt(c.getAttribute("width"), 10), h = parseInt(c.getAttribute("height"), 10);
    return (w > 0 && w <= 2) || (h > 0 && h <= 2);
  }

  function embedLink(src, doc, ctx) {
    var u = abs(cleanValue(src), ctx.base);
    if (!u) return null;
    var label = "", href = u;
    for (var i = 0; i < EMBEDS.length; i++) {
      var m = EMBEDS[i].re.exec(u);
      if (m) { href = EMBEDS[i].url(m); label = EMBEDS[i].name; break; }
    }
    var p = doc.createElement("p");
    p.className = "embed";
    var a = doc.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.textContent = "▶ " + (label ? ctx.t("embed.on", { site: label }) : ctx.t("embed.other", { site: new URL(href).hostname }));
    p.appendChild(a);
    return p;
  }

  function copy(src, out, doc, ctx, depth) {
    if (depth > 60) return;
    for (var c = src.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out.appendChild(doc.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName.toUpperCase();
      if (tag === "IFRAME") {
        var e = embedLink(c.getAttribute("src") || c.getAttribute("data-src") || "", doc, ctx);
        if (e) out.appendChild(e);
        continue;
      }
      // <source> belongs to <audio>/<video> only (a <picture> keeps its <img>)
      if (tag === "SOURCE" && !/^(audio|video)$/i.test(out.tagName || "")) continue;
      if (DROP[tag]) continue;
      if (!KEEP[tag]) { copy(c, out, doc, ctx, depth + 1); continue; }   // unknown: keep the text
      if (tag === "IMG" && tiny(c)) continue;
      var n = doc.createElement(tag.toLowerCase());
      for (var i = 0; i < c.attributes.length; i++) {
        var a = c.attributes[i], name = a.name.toLowerCase();
        var kind = ATTRS[name];
        if (!kind) continue;
        if (MEDIA_ONLY[name] && !MEDIA_ONLY[name][tag]) continue;
        if (kind === 2) {
          var val = name === "src" && tag === "IMG" ? realSrc(c) : a.value;
          var u = cleanUrl(name, val, tag, ctx);
          if (u !== null) n.setAttribute(name, u);
          continue;
        }
        if (name === "type" && tag === "SOURCE" && !/^(audio|video)\/[\w.+-]+$/i.test(a.value)) continue;
        n.setAttribute(name, cleanValue(a.value).slice(0, 500));
      }
      if (tag === "IMG" && !n.hasAttribute("src")) {
        var lazy = realSrc(c);
        if (lazy && !c.hasAttribute("src")) {
          var lu = cleanUrl("src", lazy, "IMG", ctx);
          if (lu) n.setAttribute("src", lu);
        }
        if (!n.hasAttribute("src")) {
          if (n.getAttribute("alt")) out.appendChild(doc.createTextNode(n.getAttribute("alt")));
          continue;
        }
      }
      if (tag === "IMG") {
        n.setAttribute("loading", "lazy");
        n.setAttribute("referrerpolicy", "no-referrer");
        n.setAttribute("decoding", "async");
      }
      if (tag === "A" && n.getAttribute("href")) {
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "AUDIO" || tag === "VIDEO") {
        n.setAttribute("controls", "");
        n.setAttribute("preload", "none");
      }
      copy(c, n, doc, ctx, depth + 1);
      if ((tag === "AUDIO" || tag === "VIDEO") && !n.getAttribute("src") && !n.querySelector("source[src]")) continue;
      out.appendChild(n);
    }
  }

  window.orosFeedsSanitize = function (html, opts) {
    opts = opts || {};
    var ctx = { base: opts.base || "", images: !!opts.images, blocked: 0,
                t: opts.t || function (k, p) { return (p && p.site) || k; } };
    var src = new DOMParser().parseFromString(String(html || ""), "text/html");
    var doc = document.implementation.createHTMLDocument("");
    var box = doc.createElement("div");
    copy(src.body || src.documentElement, box, doc, ctx, 0);
    return { html: box.innerHTML, blocked: ctx.blocked };
  };
})();
