// ============================================================
// orOS Reader — full article from the page (phase 2)
// Many feeds carry only a summary. This finds the main text of the
// article's own page with a small readability-style scorer: known
// article containers first, else the block whose paragraphs carry the
// most text with the fewest links. No library.
// The page is parsed in an INERT document (DOMParser: no scripts run,
// nothing loads). The result is HTML that still goes through the
// sanitizer (sanitize.js) and the sandboxed frame, like any article.
//
// window.orosFeedsExtract(html, pageUrl) -> { html, title, chars } | null
//   null: no article text found (the caller offers the original page)
// ============================================================
(function () {
  "use strict";

  var MIN_CHARS = 250;
  var JUNK_TAGS = "script,style,noscript,template,link,meta,form,button,input,select,textarea,svg,canvas,nav,footer,aside,dialog";
  var JUNK_WORDS = /(^|[\s_-])(comment|comments|disqus|share|sharing|social|related|recommend|promo|sponsor|sidebar|widget|footer|nav|navbar|menu|subscribe|newsletter|cookie|consent|banner|advert|ads?|popup|modal|breadcrumbs?|tags|author-box|byline-share|outbrain|taboola)([\s_-]|$)/i;
  var GOOD_WORDS = /(article|content|entry|post|story|body|main|text|prose)/i;
  var CONTAINERS = [
    "[itemprop=articleBody]", ".entry-content", ".post-content", ".article-content", ".article-body",
    ".article__body", ".story-body", ".post-body", ".td-post-content", ".single-content", "article .content"
  ];

  function textLen(n) { return (n.textContent || "").replace(/\s+/g, " ").trim().length; }
  function linkLen(n) {
    var s = 0;
    [].forEach.call(n.querySelectorAll("a"), function (a) { s += textLen(a); });
    return s;
  }
  function density(n) { var t = textLen(n); return t ? linkLen(n) / t : 1; }
  function label(n) { return ((n.getAttribute("class") || "") + " " + (n.getAttribute("id") || "")).trim(); }

  function clean(doc) {
    [].forEach.call(doc.querySelectorAll(JUNK_TAGS), function (n) { n.remove(); });
    // header elements inside the body are often site headers; keep the
    // ones inside an <article> (title, dek)
    [].forEach.call(doc.querySelectorAll("header"), function (n) { if (!n.closest("article")) n.remove(); });
    [].forEach.call(doc.querySelectorAll("[class],[id]"), function (n) {
      if (!n.parentNode || n === doc.body) return;
      var l = label(n);
      if (JUNK_WORDS.test(l) && !GOOD_WORDS.test(l) && n.tagName !== "ARTICLE" && n.tagName !== "MAIN") n.remove();
    });
    [].forEach.call(doc.querySelectorAll("[hidden],[aria-hidden=true]"), function (n) { n.remove(); });
  }

  function good(n) { return n && textLen(n) >= MIN_CHARS && density(n) < 0.5; }

  function known(doc) {
    for (var i = 0; i < CONTAINERS.length; i++) {
      var list = doc.querySelectorAll(CONTAINERS[i]);
      var best = null;
      [].forEach.call(list, function (n) { if (good(n) && (!best || textLen(n) > textLen(best))) best = n; });
      if (best) return best;
    }
    var arts = [].filter.call(doc.querySelectorAll("article"), good);
    if (arts.length === 1) return arts[0];
    return null;
  }

  function scored(doc) {
    var score = new Map();
    [].forEach.call(doc.querySelectorAll("p, pre, blockquote, li"), function (p) {
      var len = textLen(p);
      if (len < 25) return;
      var s = 1 + (p.textContent.split(/[,،、]/).length - 1) + Math.min(Math.floor(len / 100), 3);
      var up = p.parentElement, w = 1;
      for (var depth = 0; up && up !== doc.documentElement && depth < 3; depth++, up = up.parentElement) {
        score.set(up, (score.get(up) || 0) + s * w);
        w = depth === 0 ? 0.5 : w / 3;
      }
    });
    var best = null, bestScore = 0;
    score.forEach(function (s, n) {
      var l = label(n);
      if (GOOD_WORDS.test(l)) s *= 1.25;
      s *= 1 - density(n);
      if (s > bestScore) { best = n; bestScore = s; }
    });
    return best && good(best) ? best : null;
  }

  window.orosFeedsExtract = function (html, pageUrl) {
    var doc;
    try { doc = new DOMParser().parseFromString(String(html || ""), "text/html"); } catch (e) { return null; }
    if (!doc || !doc.body) return null;
    var og = doc.querySelector('meta[property="og:title"]');
    var title = (og && og.getAttribute("content")) || (doc.querySelector("title") || {}).textContent || "";
    // relative addresses resolve against the page itself (or its <base>)
    var base = doc.querySelector("base[href]");
    var root = pageUrl;
    try { if (base) root = new URL(base.getAttribute("href"), pageUrl).href; } catch (e) {}
    clean(doc);
    var node = known(doc) || scored(doc);
    if (!node) return null;
    // drop the article's own title (the reader shows it) and links-only blocks
    [].forEach.call(node.querySelectorAll("h1"), function (h) { if (h.textContent.trim() === title.trim()) h.remove(); });
    [].forEach.call(node.querySelectorAll("div, section, ul"), function (n) {
      if (n.parentNode && textLen(n) < 200 && density(n) > 0.6) n.remove();
    });
    var out = node.innerHTML;
    return { html: out, title: String(title).replace(/\s+/g, " ").trim().slice(0, 300), chars: textLen(node), base: root };
  };
})();
