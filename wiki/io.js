// ============================================================
// orOS Wiki — io.js: import / export converters (v1.0.0, wave 3)
// Pure text in, text out (no DOM, no storage), so the app and the
// Node tests run the same code:
//   1. Titles + file names (unique within a wiki / a zip)
//   2. Notes notebook → articles (tree → categories, links kept)
//   3. Markdown → article (front matter, # title, pictures, .md links)
//   4. Article → Markdown (pictures as ![caption](media/<id> "opts"))
//   5. Wikipedia: API URLs, wikitext → our markup, CC BY-SA credit
//   6. "Send to someone": text without pictures
//   7. Static website pages (HTML strings with every value escaped)
// Everything imported is plain text converted to our markup; no HTML
// from a file or from Wikipedia is ever kept, so nothing imported
// can run. Exposes window.WikiIO (browser) / module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  var C = (typeof module !== "undefined" && module.exports) ? require("./core.js") : root.WikiCore;
  var VERSION = "1.0.0";
  var MAX_IMPORT = 2000;        // articles in one import
  var MAX_IBOX_WP = 40;         // infobox rows taken from Wikipedia

  function str(v) { return typeof v === "string" ? v : ""; }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // ---------- 1. Titles + file names ----------
  // taken: { fold(title): true }. Returns a free title and marks it.
  function uniqueTitle(t, taken, dflt) {
    var base = C.cleanTitle(t) || C.cleanTitle(dflt) || "Untitled";
    var out = base, n = 2;
    while (taken[C.fold(out)]) out = C.cleanTitle(base.slice(0, 190) + " (" + (n++) + ")");
    taken[C.fold(out)] = true;
    return out;
  }
  // A file name from a title: no characters file systems refuse.
  function fileStem(t) {
    var s = str(t).replace(/[\\\/:*?"<>|#%\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^\.+/, "").replace(/[. ]+$/, "").slice(0, 100).trim();
    return s || "article";
  }
  // used: { lower-case name: true }
  function uniqueFile(stem, ext, used) {
    var name = stem + ext, n = 2;
    while (used[name.toLowerCase()]) name = stem + " (" + (n++) + ")" + ext;
    used[name.toLowerCase()] = true;
    return name;
  }
  // Split a text on ``` fences: [{ code: bool, s }]
  function fences(text) {
    var out = [], lines = str(text).split("\n"), cur = [], code = false;
    lines.forEach(function (l) {
      if (/^\s*```/.test(l)) {
        if (!code) { if (cur.length) out.push({ code: false, s: cur.join("\n") }); cur = [l]; code = true; }
        else { cur.push(l); out.push({ code: true, s: cur.join("\n") }); cur = []; code = false; }
        return;
      }
      cur.push(l);
    });
    if (cur.length) out.push({ code: code, s: cur.join("\n") });
    return out;
  }
  function outsideCode(text, fn) {
    return fences(text).map(function (p) { return p.code ? p.s : fn(p.s); }).join("\n");
  }
  function tasks(s) {
    return s.replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/gm, function (m, sp, x) { return sp + "- " + (x === " " ? "☐ " : "☑ "); });
  }

  // ---------- 2. Notes notebook → articles ----------
  // nd: the Notes slice { notebooks, pages, labels, tombs }.
  function notesPages(nd) {
    if (!isObj(nd) || !Array.isArray(nd.pages)) return [];
    var tombs = isObj(nd.tombs) ? nd.tombs : {};
    return nd.pages.filter(function (p) {
      return isObj(p) && typeof p.id === "string" && !(tombs[p.id] && tombs[p.id] >= (p.mtime || 0));
    });
  }
  function notesBooks(nd) {
    var pages = notesPages(nd);
    return (isObj(nd) && Array.isArray(nd.notebooks) ? nd.notebooks : []).filter(function (b) {
      return isObj(b) && typeof b.id === "string";
    }).map(function (b) {
      return { id: b.id, name: str(b.name), n: pages.filter(function (p) { return p.nb === b.id; }).length };
    }).filter(function (b) { return b.n > 0; });
  }
  // Notes text → wiki text. map: fold(old title) → new title.
  function notesText(text, nbName, map) {
    return outsideCode(str(text).replace(/\r\n?/g, "\n"), function (s) {
      s = tasks(s);
      return s.replace(/\[\[([^\[\]\n]{1,300})\]\]/g, function (m, body) {
        var bar = body.indexOf("|");
        var target = bar >= 0 ? body.slice(0, bar) : body, label = bar >= 0 ? body.slice(bar + 1) : "";
        if (/^\s*:?\s*(category|κατηγορ|file|image|αρχε|εικον)[^:]*:/i.test(target)) return m;
        var frag = "", h = target.indexOf("#");
        if (h >= 0) { frag = target.slice(h); target = target.slice(0, h); }
        var sl = target.indexOf("/");
        if (sl > 0 && C.fold(target.slice(0, sl)) === C.fold(nbName)) target = target.slice(sl + 1);
        var to = map[C.fold(target)] || target.trim();
        var shown = label || (to !== target.trim() ? target.trim() : "");
        return "[[" + to + frag + (shown ? "|" + shown : "") + "]]";
      });
    });
  }
  // → { name, arts: [{ t, x }] } in tree order (first root first).
  // taken: titles already in the target wiki (fold → true).
  function fromNotes(nd, nbId, taken, dflt, catWord) {
    taken = taken || {};
    var book = notesBooks(nd).filter(function (b) { return b.id === nbId; })[0];
    if (!book) return null;
    var pages = notesPages(nd).filter(function (p) { return p.nb === nbId; });
    var byId = {}, kids = {};
    pages.forEach(function (p) { byId[p.id] = p; });
    function order(a, b) {
      return (a.pos || 0) - (b.pos || 0) || (str(a.title) < str(b.title) ? -1 : str(a.title) > str(b.title) ? 1 : 0);
    }
    pages.forEach(function (p) {
      var par = p.parent && byId[p.parent] ? p.parent : "";
      (kids[par] = kids[par] || []).push(p);
    });
    Object.keys(kids).forEach(function (k) { kids[k].sort(order); });
    var list = [], seen = {};
    function walk(p, parent, depth) {
      if (seen[p.id] || depth > 60 || list.length >= MAX_IMPORT) return;
      seen[p.id] = true;
      list.push({ p: p, parent: parent });
      (kids[p.id] || []).forEach(function (k) { walk(k, p, depth + 1); });
    }
    (kids[""] || []).forEach(function (p) { walk(p, null, 0); });
    pages.sort(order).forEach(function (p) { walk(p, null, 0); });   // cycles left over
    var labels = {};
    (Array.isArray(nd.labels) ? nd.labels : []).forEach(function (l) { if (isObj(l) && typeof l.id === "string") labels[l.id] = C.cleanTitle(l.name); });
    var map = {}, titles = {};
    list.forEach(function (it) {
      var t = uniqueTitle(it.p.title, taken, dflt);
      titles[it.p.id] = t;
      var k = C.fold(C.cleanTitle(it.p.title));
      if (k && !map[k]) map[k] = t;
    });
    var arts = list.map(function (it) {
      var x = notesText(it.p.text, book.name, map).replace(/\s+$/, "");
      // a first "# Title" line that repeats the page title goes (the article shows its title)
      var h1 = /^\s*#\s+(.+?)\s*#*\s*(\n|$)/.exec(x);
      if (h1 && C.fold(C.cleanTitle(h1[1])) === C.fold(C.cleanTitle(it.p.title))) x = x.slice(h1[0].length).replace(/^\n+/, "");
      var cats = [];
      if (it.parent) cats.push(titles[it.parent.id]);
      (Array.isArray(it.p.labels) ? it.p.labels : []).forEach(function (id) { if (labels[id] && cats.indexOf(labels[id]) < 0) cats.push(labels[id]); });
      if (cats.length) x += (x ? "\n\n" : "") + cats.map(function (c) { return "[[" + (catWord || "Category") + ":" + c + "]]"; }).join("\n");
      return { t: titles[it.p.id], x: x.slice(0, C.MAX_TEXT) };
    });
    return { name: book.name, arts: arts };
  }

  // ---------- 3. Markdown → article ----------
  function frontMatter(text) {
    var m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(text);
    if (!m) return { text: text, title: "", tags: [] };
    var title = "", tags = [], inTags = false;
    m[1].split("\n").forEach(function (l) {
      var kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(l);
      if (kv) {
        inTags = false;
        var k = kv[1].toLowerCase(), v = kv[2].trim();
        if (k === "title") title = v.replace(/^["']|["']$/g, "");
        else if (k === "tags" || k === "categories" || k === "category") {
          if (!v) inTags = true;
          else tags = tags.concat(v.replace(/^\[|\]$/g, "").split(",").map(function (x) { return x.trim().replace(/^["'#]|["']$/g, ""); }));
        }
        return;
      }
      var li = /^\s*-\s+(.*)$/.exec(l);
      if (inTags && li) tags.push(li[1].trim().replace(/^["'#]|["']$/g, ""));
    });
    return { text: text.slice(m[0].length), title: title, tags: tags.map(C.cleanTitle).filter(Boolean) };
  }
  // ctx: { img(path, alt, opts) → markup | "", page(path) → title | "" }
  function mdBody(text, ctx) {
    ctx = ctx || {};
    return outsideCode(text, function (s) {
      s = tasks(s);
      s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g, function (m, alt, path, opts) {
        if (/^https?:\/\//i.test(path)) return C.safeUrl(path) ? "[" + (alt.trim() || path) + "](" + path + ")" : alt;
        var r = ctx.img ? ctx.img(path, alt, opts || "") : "";
        return r || alt;
      });
      s = s.replace(/!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, function (m, path, alt) {
        var r = ctx.img ? ctx.img(path.trim(), alt || "", "") : "";
        return r || (alt || "");
      });
      s = s.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+\.(md|markdown))>?\s*\)/gi, function (m, label, path) {
        if (/^[a-z]+:/i.test(path)) return m;
        var p = path;
        try { p = decodeURIComponent(path); } catch (e) {}
        var t = (ctx.page && ctx.page(p)) || C.cleanTitle(p.split("/").pop().replace(/\.(md|markdown)$/i, ""));
        return t ? "[[" + t + (C.fold(label) === C.fold(t) ? "" : "|" + label) + "]]" : label;
      });
      s = s.replace(/<br\s*\/?>/gi, " ").replace(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi, "");
      return s;
    });
  }
  // name: the file name (no folder). → { t, x, cats }
  function fromMarkdown(name, text, ctx) {
    text = str(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    text = text.replace(/\n+---\nMade with orOS \| useoros\.online\s*$/, "");
    var fm = frontMatter(text);
    text = fm.text;
    var title = fm.title;
    var lines = text.split("\n"), k = 0;
    while (k < lines.length && !lines[k].trim()) k++;
    var h = k < lines.length ? /^#\s+(.+?)\s*#*\s*$/.exec(lines[k]) : null;
    if (h && !/^#\s*(redirect|ανακατ)/i.test(lines[k])) {
      if (!title) title = h[1];
      lines.splice(0, k + 1);
      text = lines.join("\n");
    }
    if (!title) title = str(name).replace(/\.(md|markdown|txt)$/i, "");
    var x = mdBody(text, ctx).replace(/^\n+/, "").replace(/\s+$/, "");
    return { t: C.cleanTitle(title), x: x, cats: fm.tags };
  }

  // ---------- 4. Article → Markdown ----------
  function fileMd(body) {
    var fp = C.fileParts(body);
    if (!fp.id) return "";
    var opts = [];
    if (fp.al && fp.al !== "right") opts.push(fp.al);
    if (fp.w) opts.push(fp.w + "px");
    var alt = (fp.cap || fp.alt).replace(/\\\|/g, "|").replace(/[\[\]\n]/g, " ").trim();
    return "![" + alt + "](media/" + fp.id + (opts.length ? ' "' + opts.join("|") + '"' : "") + ")";
  }
  // A whole article as Markdown. Pictures in the text become standard
  // Markdown images; galleries and the infobox stay as written (their
  // pictures travel in media/ under the same names).
  function toMarkdown(a) {
    var x = outsideCode(str(a.x), function (s) {
      var out = "", i = 0;
      while (i < s.length) {
        var j = s.indexOf("[[", i);
        if (j < 0) { out += s.slice(i); break; }
        var e = C.fileEnd(s, j);
        if (e < 0) { out += s.slice(i, j + 2); i = j + 2; continue; }
        var md = fileMd(s.slice(j + 2, e - 2));
        out += s.slice(i, j) + (md || s.slice(j, e));
        i = e;
      }
      return out;
    });
    return "# " + str(a.t) + "\n\n" + x.replace(/\s+$/, "") + "\n";
  }
  // "![cap](media/<id> "left|200px")" on the way back in.
  function mediaFile(id, alt, opts, lang) {
    var o = { cap: alt };
    str(opts).split("|").forEach(function (p) {
      var q = p.trim().toLowerCase(), m;
      if (/^(left|right|center|centre|none)$/.test(q)) o.al = q === "centre" ? "center" : q;
      else if ((m = /^(\d{1,4})px$/.exec(q))) o.w = Number(m[1]);
    });
    return C.fileText(id, o, lang);
  }

  // ---------- 5. Wikipedia ----------
  var LANG_RE = /^[a-z]{2,3}(-[a-z]{2,8})?$/;
  function wpHost(lang) { return (LANG_RE.test(str(lang)) ? lang : "en") + ".wikipedia.org"; }
  function wpEnc(t) {
    return encodeURIComponent(str(t).replace(/ /g, "_")).replace(/[()'!*]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  function wpParseUrl(lang, title) {
    return "https://" + wpHost(lang) + "/w/api.php?action=parse&format=json&formatversion=2&redirects=1" +
      "&prop=wikitext%7Crevid&origin=*&page=" + encodeURIComponent(str(title).trim());
  }
  function wpSearchUrl(lang, q) {
    return "https://" + wpHost(lang) + "/w/api.php?action=opensearch&format=json&namespace=0&limit=8" +
      "&origin=*&search=" + encodeURIComponent(str(q).trim());
  }
  function wpArticleUrl(lang, title) { return "https://" + wpHost(lang) + "/wiki/" + wpEnc(title); }
  // A pasted address: https://el.wikipedia.org/wiki/Title (also m.).
  function wpFromUrl(s) {
    var m = /^https?:\/\/([a-z]{2,3}(?:-[a-z]{2,8})?)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#\s]+)/i.exec(str(s).trim());
    if (!m) return null;
    var t = m[2];
    try { t = decodeURIComponent(t); } catch (e) {}
    return { lang: m[1].toLowerCase(), title: t.replace(/_/g, " ") };
  }
  // API answers: never trusted, only strings picked out.
  function wpParseAnswer(j) {
    if (!isObj(j)) return { error: "bad" };
    if (isObj(j.error)) return { error: j.error.code === "missingtitle" || j.error.code === "invalidtitle" ? "missing" : "bad" };
    var p = j.parse;
    if (!isObj(p) || typeof p.wikitext !== "string" || typeof p.title !== "string") return { error: "bad" };
    return { title: p.title.slice(0, 250), revid: Number(p.revid) > 0 ? Math.floor(Number(p.revid)) : 0, wikitext: p.wikitext.slice(0, 2000000) };
  }
  function wpSearchAnswer(j) {
    if (!Array.isArray(j) || !Array.isArray(j[1])) return [];
    return j[1].filter(function (t) { return typeof t === "string" && t.length < 250; }).slice(0, 8);
  }

  // --- wikitext → our markup ---
  var ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", ndash: "–", mdash: "—",
    hellip: "…", laquo: "«", raquo: "»", deg: "°", times: "×", minus: "−", middot: "·",
    thinsp: " ", ensp: " ", emsp: " ", zwj: "", zwnj: "", shy: "", lrm: "", rlm: "" };
  function entities(s) {
    return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : "";
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  // Index after the "}}" closing the "{{" at i (nested), or -1.
  function tplEnd(s, i) {
    var d = 0;
    for (var j = i; j < s.length - 1; j++) {
      if (s.charAt(j) === "{" && s.charAt(j + 1) === "{") { d++; j++; }
      else if (s.charAt(j) === "}" && s.charAt(j + 1) === "}") { d--; j++; if (!d) return j + 1; }
    }
    return -1;
  }
  function linkEnd(s, i) {
    var d = 0;
    for (var j = i; j < s.length - 1; j++) {
      if (s.charAt(j) === "[" && s.charAt(j + 1) === "[") { d++; j++; }
      else if (s.charAt(j) === "]" && s.charAt(j + 1) === "]") { d--; j++; if (!d) return j + 1; }
      else if (s.charAt(j) === "\n" && s.charAt(j + 1) === "\n") return -1;
    }
    return -1;
  }
  // Split on | outside {{ }} and [[ ]].
  function splitPipes(s) {
    var out = [], cur = "", t = 0, l = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), n = s.charAt(i + 1);
      if (c === "{" && n === "{") { t++; cur += "{{"; i++; continue; }
      if (c === "}" && n === "}" && t) { t--; cur += "}}"; i++; continue; }
      if (c === "[" && n === "[") { l++; cur += "[["; i++; continue; }
      if (c === "]" && n === "]" && l) { l--; cur += "]]"; i++; continue; }
      if (c === "|" && !t && !l) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  function tplParams(parts) {
    var pos = [], named = {};
    parts.forEach(function (p) {
      var m = /^\s*([^=\[\]{}|]{1,60}?)\s*=([\s\S]*)$/.exec(p);
      if (m) named[C.fold(m[1]).replace(/[_-]/g, " ")] = { k: m[1].trim(), v: m[2].trim() };
      else pos.push(p.trim());
    });
    return { pos: pos, named: named };
  }
  function nv(p, keys) {
    for (var i = 0; i < keys.length; i++) { var v = p.named[keys[i]]; if (v && v.v) return v.v; }
    return "";
  }
  var KEEP_FIRST = /^(nowrap|nobr|small|smaller|big|larger|sic|abbr|smallcaps|sc|small caps|visible anchor|vanchor|em|strong|ipa|ipac en|audio|nowrap begin|μικρα|lang [a-z-]+|ιπα)$/;
  var KEEP_LAST = /^(lang|transl|transliteration|ξ|ξενογλωσσο|ετ|μτφ)$/;
  var INFOBOX = /^(infobox|κουτι πληροφοριων|πληροφοριες|πλαισιο πληροφοριων|taxobox|automatic taxobox|speciesbox)/;
  var CITE = /^(cite|citation|cite web|cite book|cite news|cite journal|cite magazine|cite encyclopedia|cite report|cite thesis|cite av media|cite press release|πηγη|παραθεση|cite [a-z ]+)$/;
  var REFLIST = /^(reflist|references|παραπομπες|παραπομπεσ|σημειωσεις|notelist|refs)$/;
  var SKIP_KEY = /(^|\s)(image|img|picture|photo|caption|alt|size|upright|logo|map|pushpin|signature|coat|flag|seal|module|embed|coordinates|coord|εικονα|λεζαντα|μεγεθος|χαρτησ|σημαια|εμβλημα|υπογραφη|συντεταγμενεσ|σφραγιδα|θυρεοσ)(\s|\d|$)/;

  function wtConvert(src, opts) {
    opts = opts || {};
    var ctx = { refs: [], refByName: {}, ibox: null, keep: [], lang: opts.lang === "el" ? "el" : "en", title: str(opts.title) };
    function hold(s) { ctx.keep.push(s); return "\u0001" + (ctx.keep.length - 1) + "\u0001"; }
    function unhold(s) {
      for (var g = 0; g < 4 && /\u0001\d+\u0001/.test(s); g++) {
        s = s.replace(/\u0001(\d+)\u0001/g, function (m, n) { return ctx.keep[Number(n)] || ""; });
      }
      return s;
    }
    var s = str(src).replace(/\r\n?/g, "\n").replace(/[\u0001\u0002]/g, "");
    s = s.replace(/<!--[\s\S]*?(-->|$)/g, "");
    s = s.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, function (m, x) { return hold(C.escMd(entities(x))); });
    s = s.replace(/<nowiki\s*\/>/gi, "");
    s = s.replace(/<(syntaxhighlight|source|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, tag, x) {
      return "\n" + hold("```\n" + x.replace(/```/g, "'''").replace(/^\n+|\s+$/g, "") + "\n```") + "\n";
    });
    s = s.replace(/<(math|chem|ce)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, tag, x) {
      return hold("`" + x.replace(/`/g, "'").replace(/\s+/g, " ").trim() + "`");
    });
    s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    s = s.replace(/<(gallery|timeline|imagemap|score|graph|mapframe|maplink|templatedata|templatestyles|inputbox|categorytree|indicator)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<(templatestyles|maplink|mapframe)\b[^>]*\/>/gi, "");

    // references: numbered by first use, names kept
    function refNum(name) {
      var key = name ? C.fold(name) : "";
      if (key && ctx.refByName[key]) return ctx.refByName[key];
      var r = { n: ctx.refs.length + 1, def: "" };
      ctx.refs.push(r);
      if (key) ctx.refByName[key] = r;
      return r;
    }
    function refName(attrs) {
      var m = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\/>]+))/i.exec(str(attrs));
      return m ? (m[1] || m[2] || m[3] || "").trim() : "";
    }
    s = s.replace(/<ref\b([^>]*?)\/>|<ref\b([^>]*)>([\s\S]*?)<\/ref\s*>/gi, function (m, a1, a2, body) {
      if (typeof a1 === "string" && m.slice(-2) === "/>") return "[^" + refNum(refName(a1)).n + "]";
      var r = refNum(refName(a2));
      if (!r.def && body && body.trim()) r.def = body;
      return "[^" + r.n + "]";
    });
    s = s.replace(/<references\b[^>]*\/>|<references\b[^>]*>[\s\S]*?<\/references>/gi, "\n{{references}}\n");

    // templates
    function cite(p) {
      var author = nv(p, ["author", "authors", "last", "last1", "συγγραφεασ", "επωνυμο"]);
      var first = nv(p, ["first", "first1", "ονομα"]);
      if (author && first && !p.named.author) author = author + ", " + first;
      var f = {
        title: inline(nv(p, ["title", "τιτλοσ", "script title"])), url: nv(p, ["url", "archive url"]),
        author: inline(author), site: inline(nv(p, ["website", "work", "newspaper", "journal", "magazine", "publisher", "εκδοτησ", "ιστοτοποσ"])),
        date: inline(nv(p, ["date", "year", "ημερομηνια", "ετοσ"])), publisher: inline(nv(p, ["publisher", "εκδοτησ"])),
        year: inline(nv(p, ["year", "date", "ετοσ"])), isbn: nv(p, ["isbn"]), pages: nv(p, ["pages", "page", "σελιδεσ", "σελιδα"])
      };
      var isBook = !f.url && (p.named.isbn || p.named.publisher), when = f.date;
      if (!isBook) f.date = "";
      var c = C.citeText(isBook ? "book" : "web", f, { pages: "p." });
      if (!isBook && when) c += (c ? " " : "") + C.escMd(when) + ".";
      return c.replace(/^\s*\.\s*$/, "");
    }
    function template(inner) {
      var parts = splitPipes(inner);
      var name = C.fold(parts[0].replace(/^\s*(template|πρότυπο|προτυπο)\s*:/i, "")).replace(/_/g, " ").trim();
      var p = tplParams(parts.slice(1));
      if (!name || name.charAt(0) === "#" || /^(defaultsort|displaytitle|προεπιλογη ταξινομησησ)\s*:/.test(name)) return "";
      if (INFOBOX.test(name)) {
        if (!ctx.ibox) {
          var rows = [];
          Object.keys(p.named).forEach(function (k) {
            if (rows.length >= MAX_IBOX_WP || SKIP_KEY.test(k) || /^(name|title|ονομα|τιτλοσ)$/.test(k)) return;
            var v = inline(p.named[k].v.replace(/<br\s*\/?>/gi, ", ")).replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
            if (!v || /\[\[\s*(file|image|αρχείο|αρχειο|εικόνα|εικονα)\s*:/i.test(v)) return;
            var key = p.named[k].k.replace(/_/g, " ").replace(/\s+/g, " ").replace(/[=|]/g, " ").trim();
            key = key.charAt(0).toUpperCase() + key.slice(1);
            rows.push([key, v]);
          });
          var t = inline(nv(p, ["name", "title", "ονομα", "τιτλοσ"])).replace(/\s+/g, " ").trim();
          ctx.ibox = { title: t || ctx.title, rows: rows };
        }
        return "";
      }
      if (REFLIST.test(name)) return "\n{{references}}\n";
      if (CITE.test(name)) return cite(p);
      if (name === "efn" || name === "refn" || name === "note" || name === "sfn" || name === "harvnb" || name === "sfnp") {
        var r = refNum(nv(p, ["name"]));
        if (!r.def) r.def = name.indexOf("sfn") === 0 || name === "harvnb" ? p.pos.join(" ") : (p.pos[0] || "");
        return "[^" + r.n + "]";
      }
      if (/(date|ημερομηνια)/.test(name) && /^\d{1,4}$/.test(p.pos[0] || "")) {
        var ymd = [p.pos[0]];
        if (/^\d{1,2}$/.test(p.pos[1] || "")) ymd.push(("0" + p.pos[1]).slice(-2));
        if (ymd.length > 1 && /^\d{1,2}$/.test(p.pos[2] || "")) ymd.push(("0" + p.pos[2]).slice(-2));
        return ymd.join("-");
      }
      if (name === "convert" || name === "cvt" || name === "μετατροπη") return p.pos.length >= 2 ? inline(p.pos[0]) + " " + p.pos[1] : "";
      if (KEEP_FIRST.test(name)) return p.pos.length ? inline(p.pos[name.indexOf("lang ") === 0 ? 0 : 0]) : "";
      if (KEEP_LAST.test(name)) return p.pos.length > 1 ? inline(p.pos[p.pos.length - 1]) : (p.pos[0] ? inline(p.pos[0]) : "");
      if (name === "c." || name === "circa" || name === "περ.") return "c. " + (p.pos[0] || "");
      if (name === "!") return "|";
      if (name === "=") return "=";
      if (name === "-" || name === "clear" || name === "br") return "";
      return "";
    }
    function templates(x) {
      var out = "", i = 0, guard = 0;
      while (i < x.length && guard++ < 200000) {
        var j = x.indexOf("{{", i);
        if (j < 0) { out += x.slice(i); break; }
        if (x.charAt(j + 2) === "{") {                    // {{{param}}}
          var e3 = x.indexOf("}}}", j);
          out += x.slice(i, j);
          i = e3 < 0 ? x.length : e3 + 3;
          continue;
        }
        var e = tplEnd(x, j);
        if (e < 0) { out += x.slice(i, j); i = j + 2; continue; }
        out += x.slice(i, j) + template(x.slice(j + 2, e - 2));
        i = e;
      }
      return out;
    }
    // [[links]]: pictures, categories, other languages and namespaces out
    var NS_DROP = /^(file|image|media|αρχείο|αρχειο|εικόνα|εικονα|category|κατηγορία|κατηγορια)\s*:/i;
    var NS_TEXT = /^(wikipedia|βικιπαίδεια|βικιπαιδεια|help|βοήθεια|βοηθεια|portal|πύλη|πυλη|template|πρότυπο|προτυπο|wikt|wiktionary|βικιλεξικό|commons|special|ειδικό|user|χρήστης|s|q|b|n|v|d|species|meta|mw)\s*:/i;
    function links(x) {
      var out = "", i = 0;
      while (i < x.length) {
        var j = x.indexOf("[[", i);
        if (j < 0) { out += x.slice(i); break; }
        var e = linkEnd(x, j);
        if (e < 0) { out += x.slice(i, j + 2); i = j + 2; continue; }
        out += x.slice(i, j);
        var body = x.slice(j + 2, e - 2), bar = body.indexOf("|");
        var target = (bar >= 0 ? body.slice(0, bar) : body).trim(), label = bar >= 0 ? body.slice(bar + 1).trim() : "";
        var t0 = target.replace(/^:/, "");
        if (NS_DROP.test(target)) { /* picture or category: dropped */ }
        else if (/^[a-z]{2,3}(-[a-z]+)?\s*:/.test(target) && !NS_TEXT.test(t0)) { /* other language */ }
        else if (NS_TEXT.test(t0)) out += links(label || t0.replace(NS_TEXT, ""));
        else {
          var tt = C.cleanTitle(t0.split("#")[0]), frag = t0.indexOf("#") >= 0 ? t0.slice(t0.indexOf("#")) : "";
          var shown = label ? links(label) : "";
          if (!tt && frag) out += shown || frag.slice(1);
          else if (!tt) out += shown;
          else out += "[[" + tt + frag.replace(/[\]\[|]/g, "") + (shown && shown !== tt ? "|" + shown.replace(/\]\]/g, "] ]") : "") + "]]";
        }
        i = e;
      }
      return out;
    }
    function extLinks(x) {
      return x.replace(/\[((?:https?:)?\/\/[^\s\]]+)(?:\s+([^\]\n]*))?\]/gi, function (m, url, label) {
        if (url.indexOf("//") === 0) url = "https:" + url;
        var u = C.safeUrl(url.replace(/[()]/g, function (c) { return c === "(" ? "%28" : "%29"; }));
        label = str(label).trim();
        if (!u) return label;
        return label ? "[" + label.replace(/[\[\]]/g, "") + "](" + u + ")" : u;
      });
    }
    function quotes(x) {
      return x.split("\n").map(function (l) {
        l = l.replace(/'''''(.+?)'''''/g, "***$1***").replace(/'''(.+?)'''/g, "**$1**").replace(/''(.+?)''/g, "*$1*");
        return l.replace(/'{2,}/g, "");
      }).join("\n");
    }
    function html(x) {
      x = x.replace(/<br\s*\/?>/gi, " ");
      x = x.replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~");
      x = x.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
      x = x.replace(/<(i|em|var|cite|dfn)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
      x = x.replace(/<(code|kbd|samp|tt)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, t, c) { return "`" + c.replace(/`/g, "'") + "`"; });
      x = x.replace(/<(blockquote|poem)\b[^>]*>([\s\S]*?)<\/\1>/gi, function (m, t, c) {
        return "\n" + c.trim().split("\n").map(function (l) { return "> " + l.trim(); }).join("\n") + "\n";
      });
      x = x.replace(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi, "");
      return x;
    }
    function inline(x) {
      x = templates(str(x));
      x = links(x);
      x = extLinks(x);
      x = quotes(x);
      x = html(x);
      return entities(x).replace(/__[A-ZΑ-Ω]+__/g, "");
    }

    // tables {| … |}
    function table(lines) {
      var rows = [], cur = null, hasHead = false, headRow = -1, depth = 0;
      function cell(raw, head) {
        var parts = splitPipes(raw);
        var c = parts.length > 1 && /=/.test(parts[0]) && !/\[\[|\{\{/.test(parts[0]) ? parts.slice(1).join("|") : raw;
        if (!cur) { cur = []; rows.push(cur); }
        cur.push({ v: c.trim(), h: head });
      }
      lines.forEach(function (l) {
        var t = l.trim();
        if (/^\{\|/.test(t)) { depth++; return; }
        if (/^\|\}/.test(t)) { depth--; return; }
        if (depth > 1) return;
        if (/^\|\+/.test(t)) return;
        if (/^\|-/.test(t)) { cur = []; rows.push(cur); return; }
        if (t.charAt(0) === "!") { t.slice(1).split(/!!|\|\|/).forEach(function (c) { cell(c, true); }); return; }
        if (t.charAt(0) === "|") { t.slice(1).split("||").forEach(function (c) { cell(c, false); }); return; }
        if (cur && cur.length && t) cur[cur.length - 1].v += " " + t;
      });
      rows = rows.filter(function (r) { return r.length; });
      if (!rows.length) return "";
      rows.forEach(function (r, i) { if (headRow < 0 && r.every(function (c) { return c.h; })) { headRow = i; hasHead = true; } });
      var head = hasHead ? rows.splice(headRow, 1)[0] : rows.shift();
      var conv = function (r) { return r.map(function (c) { return inline(c.v).replace(/\s+/g, " ").trim(); }); };
      var out = C.tableText(conv(head), rows.map(conv), []);
      return out.split("\n").length > 2 || rows.length ? out : "";
    }
    var lines = s.split("\n"), mid = [];
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*\{\|/.test(lines[i])) {
        var tb = [lines[i]], d = 1;
        i++;
        while (i < lines.length && d > 0) {
          if (/^\s*\{\|/.test(lines[i])) d++;
          if (/^\s*\|\}/.test(lines[i])) d--;
          tb.push(lines[i]);
          if (d > 0) i++;
        }
        var tt = table(tb);
        if (tt) mid.push("", hold(tt), "");
        continue;
      }
      mid.push(lines[i]);
    }
    s = mid.join("\n");
    s = templates(s);

    // line by line: headings, lists, definitions, indents
    var out = [];
    s.split("\n").forEach(function (l) {
      var h = /^(={1,6})\s*(.+?)\s*\1\s*$/.exec(l);
      if (h) {
        var lv = Math.max(2, Math.min(4, h[1].length));
        var ht = inline(h[2]).replace(/\s+/g, " ").trim();
        if (ht) out.push("", new Array(lv + 1).join("=") + " " + ht + " " + new Array(lv + 1).join("="), "");
        return;
      }
      var li = /^([*#:;]+)\s*(.*)$/.exec(l);
      if (li && !/^#\s*(redirect|ανακατ)/i.test(l)) {
        var marks = li[1], last = marks.charAt(marks.length - 1), body = inline(li[2]).trim();
        var ind = new Array(Math.min(marks.length, 4)).join("  ");
        if (!body) return;
        if ((last === "*" || last === "#") && out.length && out[out.length - 1].trim() && !/^\s*(- |1\. )/.test(out[out.length - 1])) out.push("");
        if (last === "*") out.push(ind + "- " + body);
        else if (last === "#") out.push(ind + "1. " + body);
        else if (last === ";") {
          var dd = body.indexOf(" : ");
          out.push("", "**" + (dd > 0 ? body.slice(0, dd) : body) + "**" + (dd > 0 ? " " + body.slice(dd + 3) : ""));
        }
        else out.push("", body, "");
        return;
      }
      if (/^\s*----+\s*$/.test(l)) { out.push("", "---", ""); return; }
      var x = inline(l);
      if (/^\s/.test(l) && x.trim() && !/^\s*\u0001/.test(l)) x = x.trim();
      if (/^\s*(\||>|-|\+|\d+[.)])\s/.test(x) && !/^\s*\u0001/.test(l)) x = "\\" + x.trim();
      out.push(x);
    });
    // headings with nothing under them go
    var res = [];
    for (var k = 0; k < out.length; k++) {
      var hm = /^(={2,4}) .+ \1$/.exec(out[k]);
      if (hm) {
        var nx = k + 1, empty = true;
        for (; nx < out.length; nx++) {
          var nh = /^(={2,4}) .+ \1$/.exec(out[nx]);
          if (nh && nh[1].length <= hm[1].length) break;
          if (out[nx].trim() && !nh) { empty = false; break; }
        }
        if (empty) continue;
      }
      res.push(out[k]);
    }
    var body = res.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    var defs = ctx.refs.map(function (r) {
      var d = r.def ? inline(r.def).replace(/\s+/g, " ").trim() : "";
      return "[^" + r.n + "]: " + (d || "…");
    });
    var top = ctx.ibox && ctx.ibox.rows.length ? C.iboxText({ title: ctx.ibox.title, rows: ctx.ibox.rows }, ctx.lang) + "\n\n" : "";
    var text = top + body + (defs.length ? "\n\n" + defs.join("\n") : "");
    return unhold(text).replace(/\{\{references\}\}(\s*\{\{references\}\})+/g, "{{references}}").replace(/\n{3,}/g, "\n\n").trim();
  }

  var CREDIT = {
    en: { h: "Source", body: "This article starts from “{a}” on Wikipedia, written by {who} and shared under {lic}. It was copied on {d} ({rev}); both texts may have changed since. If you share this article, share it under the same licence.",
      who: "its authors", rev: "this version" },
    el: { h: "Πηγή", body: "Το άρθρο ξεκινά από το «{a}» της Βικιπαίδειας, γραμμένο από {who} και διαθέσιμο με την άδεια {lic}. Αντιγράφηκε στις {d} ({rev}) και από τότε μπορεί να έχουν αλλάξει και τα δύο κείμενα. Αν το μοιραστείς, μοιράσου το με την ίδια άδεια.",
      who: "τους συντάκτες του", rev: "αυτή η έκδοση" }
  };
  function wpCredit(o) {
    var L = CREDIT[o.ui === "el" ? "el" : "en"], host = "https://" + wpHost(o.lang);
    var enc = wpEnc(o.title);
    var a = "[" + str(o.title).replace(/[\[\]]/g, "") + "](" + host + "/wiki/" + enc + ")";
    var who = "[" + L.who + "](" + host + "/w/index.php?title=" + enc + "&action=history)";
    var lic = "[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)";
    var rev = o.revid ? "[" + L.rev + "](" + host + "/w/index.php?oldid=" + o.revid + ")" : L.rev;
    return "== " + L.h + " ==\n\n" + L.body.replace("{a}", a).replace("{who}", who).replace("{lic}", lic).replace("{d}", str(o.date)).replace("{rev}", rev);
  }
  // The whole starting text: converted article + the credit section.
  function fromWikipedia(ans, o) {
    o = o || {};
    var body = wtConvert(ans.wikitext, { lang: o.ui, title: ans.title });
    var credit = wpCredit({ lang: o.lang, title: ans.title, revid: ans.revid, date: o.date, ui: o.ui });
    var room = C.MAX_TEXT - credit.length - 10;
    if (body.length > room) {
      body = body.slice(0, room);
      var cut = body.lastIndexOf("\n\n");
      if (cut > room / 2) body = body.slice(0, cut);
    }
    return { t: C.cleanTitle(ans.title), x: (body ? body + "\n\n" : "") + credit };
  }

  // ---------- 6. "Send to someone": no pictures ----------
  function shareText(x) {
    return outsideCode(str(x), function (s) {
      var out = "", i = 0;
      while (i < s.length) {
        var j = s.indexOf("[[", i);
        if (j < 0) { out += s.slice(i); break; }
        var e = C.fileEnd(s, j);
        if (e < 0) { out += s.slice(i, j + 2); i = j + 2; continue; }
        var fp = C.fileParts(s.slice(j + 2, e - 2));
        out += s.slice(i, j) + (fp.cap ? "*" + fp.cap + "*" : "");
        i = e;
      }
      var lines = out.split("\n"), keep = [], inGal = false, inBox = false;
      lines.forEach(function (l) {
        var tm = /^\s*\{\{\s*([\p{L}]+)\s*(\}\})?\s*$/u.exec(l);
        var k = tm ? C.fold(tm[1]) : "";
        if (!inGal && !inBox && tm && !tm[2] && /^(gallery|γκαλερι|συλλογη)$/.test(k)) { inGal = true; return; }
        if (!inGal && !inBox && tm && !tm[2] && /^(infobox|πλαισιο)$/.test(k)) inBox = true;
        if ((inGal || inBox) && /^\s*\}\}\s*$/.test(l)) { if (inGal) { inGal = false; return; } inBox = false; }
        if (inGal) return;
        if (inBox && /^\s*\|\s*(image|εικόνα|εικονα)\s*=/i.test(l)) return;
        keep.push(l);
      });
      return keep.join("\n");
    }).replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---------- 7. Static website ----------
  function esc(s) {
    return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // A page file name from a title (letters of any script kept).
  function pageFile(t, used) {
    var s = C.slug(t).replace(/_/g, "-").slice(0, 80) || "page", name = s + ".html", n = 2;
    while (used[name.toLowerCase()]) name = s + "-" + (n++) + ".html";
    used[name.toLowerCase()] = true;
    return name;
  }
  function href(file) { return encodeURI(file).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  var SITE_CSS = [
    ":root{--bg:#fff;--fg:#202122;--dim:#54595d;--line:#c8ccd1;--panel:#f8f9fa;--link:#3366cc;--new:#d73333;color-scheme:light dark}",
    "@media (prefers-color-scheme:dark){:root{--bg:#101418;--fg:#eaecf0;--dim:#a2a9b1;--line:#3a4048;--panel:#1b2026;--link:#88a3e8;--new:#fd7865}}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,'Noto Serif',serif}",
    "a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}.new{color:var(--new)}",
    "header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line);font-family:system-ui,sans-serif}",
    "header .wiki{font-weight:700;font-size:1.1em;color:var(--fg)}header nav{display:flex;gap:14px;flex-wrap:wrap;font-size:.92em}",
    "main{max-width:960px;margin:0 auto;padding:8px 16px 48px}h1{font-weight:400;font-size:1.9em;border-bottom:1px solid var(--line);margin:.6em 0 .4em}",
    "h2{font-weight:400;font-size:1.45em;border-bottom:1px solid var(--line);margin:1.2em 0 .4em}h3{font-size:1.15em;margin:1em 0 .3em}",
    "p,li{overflow-wrap:anywhere}pre{background:var(--panel);border:1px solid var(--line);padding:10px;overflow:auto;font-size:.9em}",
    "code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}blockquote{margin:1em 0;padding:0 1em;border-left:3px solid var(--line);color:var(--dim)}",
    ".tbl-wrap{overflow-x:auto}table{border-collapse:collapse;margin:1em 0}th,td{border:1px solid var(--line);padding:4px 8px;vertical-align:top}th{background:var(--panel)}",
    ".toc{display:inline-block;background:var(--panel);border:1px solid var(--line);padding:8px 16px;margin:8px 0;font-size:.92em}.toc-h{font-weight:700;text-align:center}.toc ol{margin:0;padding-left:1.2em;list-style:none}.toc-n{color:var(--dim)}",
    ".ibox{float:right;clear:right;width:300px;max-width:100%;margin:0 0 12px 16px;border:1px solid var(--line);background:var(--panel);font-size:.9em;padding:6px}",
    ".ibox-t{font-weight:700;text-align:center;font-size:1.15em;margin:4px 0}.ibox table{width:100%;margin:4px 0}.ibox th{text-align:left;background:none;border:0}.ibox td{border:0}",
    "figure{margin:0 0 12px}figure img{max-width:100%;height:auto;display:block}figcaption{font-size:.88em;color:var(--dim);padding-top:4px}",
    ".fig-right{float:right;clear:right;margin-left:16px;max-width:300px}.fig-left{float:left;clear:left;margin-right:16px;max-width:300px}.fig-center{margin:12px auto;text-align:center}.fig-none{max-width:100%}",
    ".gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:12px 0}.gal img{width:100%;height:140px;object-fit:cover}",
    "img.inl{max-height:1.6em;vertical-align:middle}.img-bad,.img-missing{display:inline-block;border:1px dashed var(--line);padding:6px 10px;color:var(--dim)}",
    "sup.ref{font-size:.75em;line-height:1}ol.refs{font-size:.9em}.ref-up{margin-right:4px}.cats{clear:both;margin-top:24px;padding:8px 12px;border:1px solid var(--line);background:var(--panel);font-size:.92em}",
    ".cats a{margin-right:12px}.redir{color:var(--dim)}.list{columns:2 260px}.list li{break-inside:avoid}footer{clear:both;color:var(--dim);font-size:.85em;margin-top:32px;border-top:1px solid var(--line);padding-top:8px;font-family:system-ui,sans-serif}",
    "@media (max-width:719px){.ibox,.fig-right,.fig-left{float:none;width:auto;max-width:100%;margin:12px 0}}",
    "@media print{header{display:none}}"
  ].join("\n") + "\n";
  // o: { lang, wiki, title, body (HTML built by the DOM serializer),
  //      L: { main, all, cats }, foot }
  function sitePage(o) {
    var L = o.L || {};
    return "<!DOCTYPE html>\n<html lang=\"" + esc(o.lang || "en") + "\">\n<head>\n<meta charset=\"utf-8\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; base-uri 'none'\">\n" +
      "<title>" + esc(o.title) + " · " + esc(o.wiki) + "</title>\n<link rel=\"stylesheet\" href=\"style.css\">\n</head>\n<body>\n" +
      "<header><a class=\"wiki\" href=\"index.html\">" + esc(o.wiki) + "</a><nav>" +
      "<a href=\"index.html\">" + esc(L.main) + "</a><a href=\"all.html\">" + esc(L.all) + "</a><a href=\"categories.html\">" + esc(L.cats) + "</a>" +
      "</nav></header>\n<main>\n<h1>" + esc(o.title) + "</h1>\n" + str(o.body) + "\n<footer>" + esc(o.foot || "") + "</footer>\n</main>\n</body>\n</html>\n";
  }
  // A list page: items [{ t, file }] → <ul class="list">.
  function siteList(items) {
    return "<ul class=\"list\">" + items.map(function (it) {
      return "<li><a href=\"" + esc(href(it.file)) + "\">" + esc(it.t) + "</a></li>";
    }).join("") + "</ul>";
  }

  var API = {
    VERSION: VERSION, MAX_IMPORT: MAX_IMPORT,
    uniqueTitle: uniqueTitle, fileStem: fileStem, uniqueFile: uniqueFile,
    notesBooks: notesBooks, notesText: notesText, fromNotes: fromNotes,
    frontMatter: frontMatter, mdBody: mdBody, fromMarkdown: fromMarkdown, toMarkdown: toMarkdown, mediaFile: mediaFile,
    wpHost: wpHost, wpParseUrl: wpParseUrl, wpSearchUrl: wpSearchUrl, wpArticleUrl: wpArticleUrl, wpFromUrl: wpFromUrl,
    wpParseAnswer: wpParseAnswer, wpSearchAnswer: wpSearchAnswer, wtConvert: wtConvert, wpCredit: wpCredit, fromWikipedia: fromWikipedia,
    shareText: shareText, esc: esc, pageFile: pageFile, href: href, SITE_CSS: SITE_CSS, sitePage: sitePage, siteList: siteList
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.WikiIO = API;
})(typeof window !== "undefined" ? window : globalThis);
