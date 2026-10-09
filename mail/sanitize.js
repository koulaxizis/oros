// ============================================================
// orOS Mail — HTML e-mail sanitizer (first wall)
// Parses the message in an INERT document (DOMParser: no scripts
// run, nothing loads) and rebuilds it from an allowlist of tags,
// attributes, URL schemes and CSS. The result is shown inside a
// sandboxed iframe (no scripts, opaque origin, CSP) — the second
// wall (mail.js, renderHtml). Either wall alone must hold.
//
// window.orosMailSanitize(html, { remote: bool, cids: {cid: dataUrl} })
//   → { html, blocked }   blocked = remote resources left out
// ============================================================
(function () {
  "use strict";

  // Dropped with their whole content.
  var DROP = {
    SCRIPT: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1,
    APPLET: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, LINK: 1, META: 1,
    BASE: 1, TITLE: 1, SVG: 1, MATH: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, TRACK: 1, CANVAS: 1,
    DIALOG: 1, PORTAL: 1, PICTURE: 1, MAP: 1, AREA: 1, HEAD: 1, PARAM: 1, XML: 1
  };
  var KEEP = {
    A: 1, ABBR: 1, ADDRESS: 1, ARTICLE: 1, ASIDE: 1, B: 1, BDI: 1, BDO: 1, BIG: 1, BLOCKQUOTE: 1,
    BR: 1, CAPTION: 1, CENTER: 1, CITE: 1, CODE: 1, COL: 1, COLGROUP: 1, DD: 1, DEL: 1, DETAILS: 1,
    DFN: 1, DIV: 1, DL: 1, DT: 1, EM: 1, FIGCAPTION: 1, FIGURE: 1, FONT: 1, FOOTER: 1, H1: 1, H2: 1,
    H3: 1, H4: 1, H5: 1, H6: 1, HEADER: 1, HR: 1, I: 1, IMG: 1, INS: 1, KBD: 1, LI: 1, MAIN: 1,
    MARK: 1, NAV: 1, OL: 1, P: 1, PRE: 1, Q: 1, S: 1, SAMP: 1, SECTION: 1, SMALL: 1, SPAN: 1,
    STRIKE: 1, STRONG: 1, STYLE: 1, SUB: 1, SUMMARY: 1, SUP: 1, TABLE: 1, TBODY: 1, TD: 1,
    TFOOT: 1, TH: 1, THEAD: 1, TR: 1, TT: 1, U: 1, UL: 1, WBR: 1
  };
  var ATTRS = {
    style: 1, "class": 1, dir: 1, lang: 1, title: 1, align: 1, valign: 1, width: 1, height: 1,
    bgcolor: 1, color: 1, border: 1, cellpadding: 1, cellspacing: 1, colspan: 1, rowspan: 1,
    face: 1, size: 1, alt: 1, start: 1, type: 1, nowrap: 1, span: 1, scope: 1, headers: 1,
    reversed: 1, href: 2, src: 2, background: 2
  };
  var IMG_DATA = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

  function remoteOk(u) { return /^https?:\/\//i.test(u); }

  // CSS: no scripting hooks, no imports; url() follows the image rule.
  function cleanCss(css, ctx) {
    css = String(css || "");
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    css = css.replace(/\\/g, "");   // no escapes: the checks below see plain text
    css = css.replace(/</g, "");     // a <style> body must never close itself
    css = css.replace(/expression\s*\(|behavio(u)?r\s*:|-moz-binding|javascript:|vbscript:/gi, "x-blocked(");
    css = css.replace(/@import[^;]*;?/gi, "");
    return css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, function (m, q, u) {
      u = u.trim();
      var cid = /^cid:(.+)$/i.exec(u);
      if (cid) return ctx.cids[cid[1]] ? "url(\"" + ctx.cids[cid[1]] + "\")" : "none";
      if (IMG_DATA.test(u)) return "url(\"" + u.replace(/["\s]/g, "") + "\")";
      if (remoteOk(u)) {
        if (ctx.remote) return "url(\"" + u.replace(/["()\s]/g, encodeURIComponent) + "\")";
        ctx.blocked++;
        return "none";
      }
      return "none";
    });
  }

  function cleanUrl(name, value, tag, ctx) {
    var v = String(value || "").replace(/[\u0000-\u0020\u007f-\u009f]+/g, "").trim();
    if (name === "href") {
      if (tag !== "A") return null;
      if (/^(https?:|mailto:)/i.test(v)) return v;
      return null;
    }
    // src (IMG) / background (TABLE, TD, BODY…)
    var cid = /^cid:(.+)$/i.exec(v);
    if (cid) return ctx.cids[cid[1]] || null;
    if (IMG_DATA.test(v)) return v.replace(/\s/g, "");
    if (remoteOk(v)) {
      if (ctx.remote) return v;
      ctx.blocked++;
      return null;
    }
    return null;
  }

  function copy(src, out, doc, ctx) {
    for (var c = src.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out.appendChild(doc.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName.toUpperCase();
      if (DROP[tag]) continue;
      if (!KEEP[tag]) { copy(c, out, doc, ctx); continue; }   // unknown: keep the text, lose the tag
      var n = doc.createElement(tag.toLowerCase());
      if (tag === "STYLE") {
        n.textContent = cleanCss(c.textContent, ctx);
        out.appendChild(n);
        continue;
      }
      for (var i = 0; i < c.attributes.length; i++) {
        var a = c.attributes[i], name = a.name.toLowerCase();
        var kind = ATTRS[name];
        if (!kind) continue;
        if (kind === 2) {
          if (name === "src" && tag !== "IMG") continue;
          var u = cleanUrl(name, a.value, tag, ctx);
          if (u !== null) n.setAttribute(name, u);
          continue;
        }
        n.setAttribute(name, name === "style" ? cleanCss(a.value, ctx) : a.value);
      }
      if (tag === "A" && n.getAttribute("href")) {
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
        n.setAttribute("title", n.getAttribute("href"));   // the real destination, always
      }
      copy(c, n, doc, ctx);
      out.appendChild(n);
    }
  }

  window.orosMailSanitize = function (html, opts) {
    opts = opts || {};
    var ctx = { remote: !!opts.remote, cids: opts.cids || {}, blocked: 0 };
    var src = new DOMParser().parseFromString(String(html || ""), "text/html");
    var doc = document.implementation.createHTMLDocument("");
    var box = doc.createElement("div");
    // <style> blocks of <head> carry most of a newsletter's layout
    [].forEach.call(src.querySelectorAll("head style"), function (s) {
      var n = doc.createElement("style");
      n.textContent = cleanCss(s.textContent, ctx);
      box.appendChild(n);
    });
    var body = src.body || src.documentElement;
    var bg = body && body.getAttribute && body.getAttribute("bgcolor");
    copy(body, box, doc, ctx);
    if (bg && /^#?[0-9a-z]{3,20}$/i.test(bg)) box.setAttribute("style", "background-color:" + bg);
    return { html: box.outerHTML, blocked: ctx.blocked };
  };
})();
