// ============================================================
// orOS Mail — formatted writing (v1.0.0)
// The editor for messages and signatures (bold, italic, underline,
// lists, links, colour; pictures in signatures) and the one place
// where its HTML is cleaned for sending or keeping.
//
// clean(nodeOrHtml, { cid }) → { html, text, inline[], rich }
//   Rebuilds the content from an allowlist (b i u s br div ul ol li
//   blockquote a[href http(s)/mailto] img span[color]); everything
//   else keeps only its text. A string is parsed in an INERT document
//   (DOMParser: no scripts, nothing loads). html is built by this code
//   with every text and attribute escaped, so it is safe to put back
//   into an editor. cid: true turns data: pictures into "cid:" parts
//   (inline[{ cid, type, bin }]) for sending; false keeps them as data:
//   (stored signatures, the Outbox). rich = anything beyond plain
//   lines and the reply quote (then the message goes as text + HTML).
//   text = the plain-text version (lists as "- ", links as
//   "text <url>", quotes as "> ").
// fromText(text) → html     escape + line breaks
// quoteHtml(text) → html    a "> " quoted reply as a blockquote
// editor({ html, label, pictures }) → { box, area, get(cid), set(html) }
// Exposed as window.orosMailRich.
// ============================================================
(function (root) {
  "use strict";
  var doc = root.document;
  var MAX_IMG = 120 * 1024;          // data: URL length of one picture
  var IMG_DATA = /^data:image\/(png|jpeg|gif);base64,([a-z0-9+/=]+)$/i;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hex2(n) { n = Math.max(0, Math.min(255, n | 0)); return (n < 16 ? "0" : "") + n.toString(16); }
  function color(v) {
    v = String(v || "").trim().toLowerCase();
    var m;
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v))) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    if ((m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v))) return "#" + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]);
    return "";
  }
  function href(v) {
    v = String(v || "").replace(/[\u0000- \u007f-\u009f]+/g, "").trim();
    return /^(https?:\/\/|mailto:)/i.test(v) && v.length <= 2000 ? v : "";
  }

  var TAG = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s",
              DIV: "div", P: "div", UL: "ul", OL: "ol", LI: "li", BLOCKQUOTE: "blockquote",
              H1: "div", H2: "div", H3: "div", H4: "div", H5: "div", H6: "div" };
  var DROP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1, HEAD: 1,
               TITLE: 1, META: 1, LINK: 1, NOSCRIPT: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1 };
  var RICH = { b: 1, i: 1, u: 1, s: 1, ul: 1, ol: 1, a: 1, img: 1, span: 1 };
  var BLOCK = { div: 1, ul: 1, ol: 1, li: 1, blockquote: 1 };

  function clean(src, opts) {
    opts = opts || {};
    var rootNode = src;
    if (typeof src === "string" || src == null) {
      rootNode = new root.DOMParser().parseFromString("<!DOCTYPE html><body>" + String(src || ""), "text/html").body;
    }
    var inline = [], seen = {}, rich = false, n = 0;
    function picture(img) {
      var s = img.getAttribute("src") || "";
      var m = IMG_DATA.exec(s.replace(/\s+/g, ""));
      if (m && s.length <= MAX_IMG) {
        if (!opts.cid) return s.replace(/\s+/g, "");
        var key = m[2].length + ":" + m[2].slice(0, 64) + m[2].slice(-64);
        if (!seen[key]) {
          var bin = "";
          try { bin = root.atob(m[2]); } catch (e) { return ""; }
          seen[key] = "img" + (++n) + "." + Date.now().toString(36) + "@oros";
          inline.push({ cid: seen[key], type: "image/" + m[1].toLowerCase(), bin: bin });
        }
        return "cid:" + seen[key];
      }
      if (/^https:\/\//i.test(s) && s.length <= 2000) return s;
      return "";
    }
    function walk(node) {
      var out = "";
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += esc(c.nodeValue); continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName.toUpperCase();
        if (DROP[tag]) continue;
        if (tag === "BR") { out += "<br>"; continue; }
        if (tag === "IMG") {
          var u = picture(c);
          if (!u) continue;
          var w = +c.getAttribute("width"), h = +c.getAttribute("height");
          out += "<img src=\"" + esc(u) + "\" alt=\"" + esc((c.getAttribute("alt") || "").slice(0, 200)) + "\"" +
                 (w > 0 && w <= 600 ? " width=\"" + Math.round(w) + "\"" : "") +
                 (h > 0 && h <= 600 ? " height=\"" + Math.round(h) + "\"" : "") + ">";
          rich = true;
          continue;
        }
        var inner = walk(c);
        if (tag === "A") {
          var hr = href(c.getAttribute("href"));
          if (hr) { out += "<a href=\"" + esc(hr) + "\">" + inner + "</a>"; rich = true; }
          else out += inner;
          continue;
        }
        var col = "";
        if (tag === "FONT") col = color(c.getAttribute("color"));
        if (c.style && c.style.color) col = color(c.style.color) || col;
        var t = TAG[tag];
        var piece = col ? "<span style=\"color:" + col + "\">" + inner + "</span>" : inner;
        if (col) rich = true;
        // <span style="font-weight:bold"> (some browsers' bold) → <b>
        if (!t && c.style && (c.style.fontWeight === "bold" || +c.style.fontWeight >= 600)) { piece = "<b>" + piece + "</b>"; rich = true; }
        if (t) {
          if (RICH[t]) rich = true;
          piece = "<" + t + ">" + piece + "</" + t + ">";
        }
        out += piece;
      }
      return out;
    }
    var html = walk(rootNode);
    return { html: html, text: toText(rootNode), inline: inline, rich: rich };
  }

  // ---------- plain-text version ----------
  function toText(node) {
    var out = "";
    function nl() { if (out && out.slice(-1) !== "\n") out += "\n"; }
    function walk(n, list) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += c.nodeValue.replace(/ /g, " ").replace(/[\r\n]+/g, " "); continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName.toUpperCase();
        if (DROP[tag]) continue;
        if (tag === "BR") { out += "\n"; continue; }
        if (tag === "IMG") { var alt = c.getAttribute("alt"); if (alt) out += alt; continue; }
        if (tag === "BLOCKQUOTE") {
          nl();
          var save = out;
          out = "";
          walk(c, null);
          var q = out.replace(/\n+$/, "").split("\n").map(function (l) { return l.charAt(0) === ">" ? ">" + l : "> " + l; }).join("\n");
          out = save + q + "\n";
          continue;
        }
        if (tag === "UL" || tag === "OL") { nl(); walk(c, { ol: tag === "OL", i: 0 }); nl(); continue; }
        if (tag === "LI") {
          nl();
          out += list && list.ol ? (++list.i) + ". " : "- ";
          walk(c, null);
          nl();
          continue;
        }
        if (tag === "A") {
          var before = out.length;
          walk(c, list);
          var label = out.slice(before).trim();
          var hr = href(c.getAttribute("href"));
          var bare = hr.replace(/^mailto:/i, "");
          if (hr && label !== hr && label !== bare) out += " <" + bare + ">";
          continue;
        }
        var block = BLOCK[TAG[tag]] || tag === "P";
        if (block) nl();
        walk(c, list);
        if (block) nl();
      }
    }
    walk(node, null);
    return out.replace(/[ \t]+\n/g, "\n").replace(/^--$/mg, "-- ")      // keep the "-- " signature line
      .replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  }

  function fromText(text) {
    return esc(String(text || "").replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
  }
  // "On … wrote:\n> line\n> > older" → the first line, then the quote.
  function quoteHtml(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").replace(/^\n+/, "").split("\n");
    var head = [], body = [];
    lines.forEach(function (l) {
      if (!body.length && l.charAt(0) !== ">") head.push(l);
      else body.push(l.replace(/^> ?/, ""));
    });
    return (head.length ? fromText(head.join("\n")) : "") +
           (body.length ? "<blockquote>" + fromText(body.join("\n")) + "</blockquote>" : "");
  }

  // ---------- the editor ----------
  var ICON = {
    b: '<b>B</b>', i: '<i>I</i>', u: '<u>U</u>',
    ul: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    ol: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
    link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    color: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 20M12 3l7 17M8 13h8"/></svg>',
    clear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h12v2M10 5l-3 14M4 19h8"/><line x1="15" y1="13" x2="21" y2="19"/><line x1="21" y1="13" x2="15" y2="19"/></svg>',
    img: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
  };
  var SWATCH = ["#000000", "#555555", "#c62828", "#e65100", "#2e7d32", "#1565c0", "#6a1b9a"];

  // labels: { b, i, u, ul, ol, link, linkAsk, color, clear, img, imgBig }
  function editor(o) {
    o = o || {};
    var L = o.labels || {};
    var box = doc.createElement("div");
    box.className = "rte";
    var bar = doc.createElement("div");
    bar.className = "rte-bar";
    bar.setAttribute("role", "toolbar");
    if (L.bar) bar.setAttribute("aria-label", L.bar);
    var area = doc.createElement("div");
    area.className = "rte-area";
    area.contentEditable = "true";
    area.setAttribute("role", "textbox");
    area.setAttribute("aria-multiline", "true");
    if (o.label) area.setAttribute("aria-label", o.label);
    if (o.id) area.id = o.id;
    var saved = null;
    function keep() {
      var s = root.getSelection && root.getSelection();
      if (s && s.rangeCount && area.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange();
    }
    function back() {
      area.focus();
      if (saved) { var s = root.getSelection(); s.removeAllRanges(); s.addRange(saved); }
    }
    function cmd(name, val) {
      back();
      try { doc.execCommand("styleWithCSS", false, false); } catch (e) {}
      doc.execCommand(name, false, val === undefined ? null : val);
      keep();
      area.dispatchEvent(new root.Event("input", { bubbles: true }));
    }
    function btn(key, label, fn) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "rte-btn";
      b.innerHTML = ICON[key];
      b.title = label || key;
      b.setAttribute("aria-label", label || key);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the selection
      b.addEventListener("click", fn);
      bar.appendChild(b);
      return b;
    }
    btn("b", L.b, function () { cmd("bold"); });
    btn("i", L.i, function () { cmd("italic"); });
    btn("u", L.u, function () { cmd("underline"); });
    btn("ul", L.ul, function () { cmd("insertUnorderedList"); });
    btn("ol", L.ol, function () { cmd("insertOrderedList"); });
    var linkBtn = btn("link", L.link, function () {
      keep();
      var u = root.prompt(L.linkAsk || "https://", "https://");
      u = href(u && !/^[a-z]+:/i.test(u.trim()) && /@/.test(u) ? "mailto:" + u.trim() : (u && !/^[a-z]+:/i.test(u.trim()) ? "https://" + u.trim() : u));
      if (!u) return;
      var s = saved;
      if (s && s.collapsed) {
        back();
        doc.execCommand("insertText", false, u.replace(/^mailto:/i, ""));
        var r = root.getSelection().getRangeAt(0);
        r.setStart(r.endContainer, Math.max(0, r.endOffset - u.replace(/^mailto:/i, "").length));
        root.getSelection().removeAllRanges();
        root.getSelection().addRange(r);
        keep();
      }
      cmd("createLink", u);
    });
    var cbtn = btn("color", L.color, function () { pal.hidden = !pal.hidden; });
    cbtn.setAttribute("aria-haspopup", "true");
    var pal = doc.createElement("span");
    pal.className = "rte-pal";
    pal.hidden = true;
    SWATCH.forEach(function (c) {
      var s = doc.createElement("button");
      s.type = "button";
      s.className = "rte-sw";
      s.style.background = c;
      s.setAttribute("aria-label", c);
      s.addEventListener("mousedown", function (e) { e.preventDefault(); });
      s.addEventListener("click", function () { pal.hidden = true; cmd("foreColor", c); });
      pal.appendChild(s);
    });
    bar.appendChild(pal);
    btn("clear", L.clear, function () { cmd("removeFormat"); cmd("unlink"); });
    if (o.pictures) {
      var file = doc.createElement("input");
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/gif";
      file.hidden = true;
      bar.appendChild(file);
      btn("img", L.img, function () { keep(); file.value = ""; file.click(); });
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        shrink(f).then(function (url) {
          if (!url) { if (o.onError) o.onError(L.imgBig || "too big"); return; }
          cmd("insertImage", url);
        });
      });
    }
    // Focus without a caret inside (e.g. a click below the text, or the
    // label): put it at the start, where the new text goes.
    area.addEventListener("focus", function () {
      setTimeout(function () {
        var sl = root.getSelection();
        if (sl && sl.rangeCount && area.contains(sl.anchorNode)) return;
        var r = doc.createRange();
        r.setStart(area, 0);
        r.collapse(true);
        sl.removeAllRanges();
        sl.addRange(r);
      }, 0);
    });
    area.addEventListener("keyup", keep);
    area.addEventListener("mouseup", keep);
    area.addEventListener("blur", keep);
    // Paste and drop: text only (no foreign styles, scripts or remote pictures)
    area.addEventListener("paste", function (e) {
      e.preventDefault();
      var tx = (e.clipboardData || root.clipboardData).getData("text/plain");
      if (tx) doc.execCommand("insertText", false, tx);
    });
    area.addEventListener("drop", function (e) {
      e.preventDefault();
      var tx = e.dataTransfer && e.dataTransfer.getData("text/plain");
      if (tx) doc.execCommand("insertText", false, tx);
    });
    area.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") { e.preventDefault(); cmd({ b: "bold", i: "italic", u: "underline" }[k]); }
      if (k === "k") { e.preventDefault(); linkBtn.click(); }
    });
    box.appendChild(bar);
    box.appendChild(area);
    function set(html) { area.innerHTML = clean(html || "", { cid: false }).html; }
    set(o.html || "");
    return { box: box, area: area, set: set, get: function (cid) { return clean(area, { cid: !!cid }); } };
  }

  // A picture for a signature: at most 300×150, PNG (or JPEG for
  // photos), small enough to sync. → data: URL or "" (too big / broken).
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\/(png|jpeg|gif)$/.test(file.type) || file.size > 8 * 1024 * 1024) { resolve(""); return; }
      var url = root.URL.createObjectURL(file);
      var img = new root.Image();
      img.onload = function () {
        var k = Math.min(1, 300 / img.naturalWidth, 150 / img.naturalHeight);
        var w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        var cv = doc.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        root.URL.revokeObjectURL(url);
        var out = cv.toDataURL("image/png");
        if (out.length > MAX_IMG || file.type === "image/jpeg") {
          var j = cv.toDataURL("image/jpeg", 0.85);
          if (j.length < out.length) out = j;
        }
        resolve(out.length <= MAX_IMG ? out : "");
      };
      img.onerror = function () { root.URL.revokeObjectURL(url); resolve(""); };
      img.src = url;
    });
  }

  root.orosMailRich = { v: 1, clean: clean, toText: toText, fromText: fromText, quoteHtml: quoteHtml, editor: editor, esc: esc };
})(window);
