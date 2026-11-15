// ============================================================
// orOS Writer — catcore.js: book translation, pure part (WR-CAT, T1)
// A source document is cut into segments (one sentence each, inside a
// paragraph, heading, list item, cell, caption, the title, the header,
// the footer and each footnote). Formatting inside a segment (bold,
// italic, links, footnote numbers, pictures) becomes numbered tags:
//   ⟦1⟧ … ⟦/1⟧   a pair (bold, italic, link …)
//   ⟦2/⟧         one piece (a footnote number, a picture, a break)
// The translator moves them with the words; build() puts the original
// markup back around the translated words, so the translated book
// keeps the source's look. Everything outside the segments (tables,
// lists, page breaks, attributes) comes back byte for byte from a
// template.
// Rows (the translations) are kept per device: each device writes only
// the rows it changed (rows-<device>-<chunk>.json), so two devices never
// write the same file; reading merges every device's rows, the newer
// stamp wins per segment (mergeRows).
// No DOM: the same file runs in Writer and in tests/writer-cat.test.js.
// Exposes window.WriterCatCore (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var Core = node ? require("./core.js") : root.WriterCore;

  var VERSION = 1;
  var CHUNK = 200;                 // segments per rows file
  var MAX_SEGS = 60000;            // a very long book is about 20000
  var MAX_TEXT = 20000;            // characters of one translation
  var OPEN = "⟦", CLOSE = "⟧";   // ⟦ ⟧
  var MK_A = "", MK_B = "";    // template markers (private use)
  var TAG_RX = /⟦(\/?)(\d{1,4})(\/?)⟧/g;

  // Languages offered for a project (BCP 47 code, own name). Any other
  // code is allowed too (lowercase letters, an optional region).
  var LANGS = [
    ["en", "English"], ["el", "Ελληνικά"], ["de", "Deutsch"], ["fr", "Français"],
    ["it", "Italiano"], ["es", "Español"], ["pt", "Português"], ["nl", "Nederlands"],
    ["sv", "Svenska"], ["da", "Dansk"], ["no", "Norsk"], ["fi", "Suomi"],
    ["pl", "Polski"], ["cs", "Čeština"], ["ro", "Română"], ["bg", "Български"],
    ["sq", "Shqip"], ["sr", "Српски"], ["tr", "Türkçe"], ["ru", "Русский"],
    ["uk", "Українська"], ["ar", "العربية"], ["he", "עברית"], ["zh", "中文"],
    ["ja", "日本語"], ["ko", "한국어"]
  ];
  var LANG_RX = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
  function cleanLang(v) { v = String(v || "").trim(); return LANG_RX.test(v) ? v : ""; }

  // ---------- 1. A small tag-aware reader (as commands.js) ----------
  var TOKEN_RX = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  function parse(html) {
    var top = { tag: "", attrs: "", kids: [] }, stack = [top], last = 0, m;
    html = String(html || "");
    function cur() { return stack[stack.length - 1]; }
    function text(s) { if (s) cur().kids.push({ raw: s }); }
    TOKEN_RX.lastIndex = 0;
    while ((m = TOKEN_RX.exec(html))) {
      text(html.slice(last, m.index));
      last = TOKEN_RX.lastIndex;
      if (!m[2]) { cur().kids.push({ cm: m[0] }); continue; }
      var tag = m[2].toLowerCase();
      if (m[1]) {
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
        continue;
      }
      var el = { tag: tag, attrs: m[3], kids: [] };
      cur().kids.push(el);
      if (VOID[tag] || /\/\s*$/.test(m[3])) el.v = 1;
      else stack.push(el);
    }
    text(html.slice(last));
    return top;
  }
  function openOf(n) { return "<" + n.tag + n.attrs + ">"; }
  function ser(n) {
    if (n.raw !== undefined) return n.raw;
    if (n.cm !== undefined) return n.cm;
    if (n.mk !== undefined) return n.mk;
    var s = n.kids.map(ser).join("");
    if (!n.tag) return s;
    return openOf(n) + (n.v ? "" : s + "</" + n.tag + ">");
  }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
      if (e.charAt(0) === "#") {
        var c = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
      }
      return ENT[e.toLowerCase()];
    });
  }
  function encode(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
  }
  function hasClass(n, c) {
    var m = /\sclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(n.attrs || "");
    var v = m ? (m[2] || m[3] || m[4] || "") : "";
    return (" " + v + " ").indexOf(" " + c + " ") >= 0;
  }

  // ---------- 2. Blocks and runs ----------
  var BLOCK = {};
  ("p h1 h2 h3 h4 h5 h6 div blockquote ul ol li table thead tbody tfoot tr td th caption figure figcaption " +
   "pre hr section article header footer nav aside dl dt dd address details summary colgroup col main").split(" ")
    .forEach(function (k) { BLOCK[k] = 1; });
  var RAW_BLOCK = { pre: 1, hr: 1, colgroup: 1, col: 1, script: 1, style: 1, svg: 1, math: 1, template: 1 };
  var HEAD = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
  function isBlock(n) { return !!(n.tag && (BLOCK[n.tag] || RAW_BLOCK[n.tag])); }
  function hasBlock(n) {
    if (!n.kids) return false;
    for (var i = 0; i < n.kids.length; i++) {
      var k = n.kids[i];
      if (k.tag && (isBlock(k) || hasBlock(k))) return true;
    }
    return false;
  }
  var WORD_RX = /[\p{L}\p{N}]/u;
  function isTcDel(n) { return n.tag === "del" && hasClass(n, "tc"); }
  function isUnwrap(n) { return (n.tag === "ins" && hasClass(n, "tc")) || (n.tag === "mark" && hasClass(n, "cmt-mark")); }
  function plainOf(n) {
    if (n.raw !== undefined) return decode(n.raw);
    if (!n.tag || isTcDel(n)) return "";
    if (n.tag === "br") return "\n";
    if (n.tag === "sup" && hasClass(n, "fn-ref")) return "";
    return (n.kids || []).map(plainOf).join("");
  }
  function hasPiece(n) {
    if (!n.tag) return false;
    if (n.tag === "img" || n.tag === "br" || (n.tag === "sup" && hasClass(n, "fn-ref"))) return true;
    return (n.kids || []).some(hasPiece);
  }

  // A run (consecutive inline nodes) → tokens:
  //   { x: text } | { o: id } | { c: id } | { v: id, nl: 0|1 }
  // tags[id] = ["p", open, close, name] | ["v", html, "", name]
  function runTokens(nodes, tags) {
    var out = [];
    function piece(html, name, nl) { tags.push(["v", html, "", name]); out.push({ v: tags.length - 1, nl: nl ? 1 : 0 }); }
    function walk(n) {
      if (n.raw !== undefined) {
        var s = decode(n.raw).replace(/[ \t\r\n\f]+/g, " ").replace(/[⟦⟧]/g, function (c) { return c === OPEN ? "[" : "]"; });
        if (s) out.push({ x: s });
        return;
      }
      if (n.cm !== undefined || !n.tag || isTcDel(n)) return;
      if (isUnwrap(n)) { n.kids.forEach(walk); return; }
      if (n.v || (n.tag === "sup" && hasClass(n, "fn-ref"))) { piece(ser(n), n.tag, n.tag === "br"); return; }
      var pt = plainOf(n);
      if (!WORD_RX.test(pt)) {
        // nothing to translate inside (an empty span, <b><br></b>, a space)
        if (!pt && !hasPiece(n)) { if (n.kids.length) piece(ser(n), n.tag, 0); return; }
        piece(ser(n), n.tag, /\n/.test(pt));
        return;
      }
      tags.push(["p", openOf(n), "</" + n.tag + ">", n.tag]);
      var id = tags.length - 1;
      out.push({ o: id });
      n.kids.forEach(walk);
      out.push({ c: id });
    }
    nodes.forEach(walk);
    // join neighbouring texts
    var j = [];
    out.forEach(function (t) {
      if (t.x !== undefined && j.length && j[j.length - 1].x !== undefined) j[j.length - 1].x += t.x;
      else j.push(t);
    });
    return j;
  }

  // ---------- 3. Sentences ----------
  // Words that end with a full stop without ending the sentence.
  // i18n-inline-ok: abbreviations are data (no UI text)
  var ABBR = ["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "mt", "vol", "pp", "fig", "cf", "ca", "approx",
    "e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "κ", "κα", "π.χ", "δηλ", "βλ", "σελ", "αι", "π.χ", "μ.χ", "κ.ά", "κτλ", "κλπ", "αρ", "τηλ", "οδ", "χλμ", "μτφ", "επιμ"];
  function abbrevEnd(text) {
    var m = /(?:^|[\s(«"“'‘])([\p{L}][\p{L}.]{0,6})\.$/u.exec(text);
    if (!m) return false;
    var w = m[1].toLowerCase();
    if (ABBR.indexOf(w) >= 0) return true;
    return /^\p{Lu}$/u.test(m[1]);    // an initial: J. R. R. Tolkien
  }
  // [{s, e}] over the plain text (a line break always ends a sentence)
  function sentences(plain, lang) {
    var r = Core.sentenceRanges(plain, lang === "el" ? "el" : "en");
    var out = [];
    r.forEach(function (x) {
      var prev = out[out.length - 1];
      if (prev && plain.slice(prev.e, x.s).indexOf("\n") < 0 && abbrevEnd(plain.slice(prev.s, prev.e))) { prev.e = x.e; return; }
      out.push({ s: x.s, e: x.e });
    });
    return out;
  }

  // ---------- 4. Cutting a run into segments ----------
  // Returns { lead, trail, segs: [{ toks, sep }] } where lead / trail /
  // sep are raw html (or plain text for plain blocks) and toks the
  // segment's tokens.
  function cutRun(toks, lang, plainMode) {
    // offsets
    var plain = "", pos = [];
    toks.forEach(function (t) {
      pos.push(plain.length);
      if (t.x !== undefined) plain += t.x;
      else if (t.v !== undefined && t.nl) plain += "\n";
    });
    var ranges = sentences(plain, lang);
    if (!ranges.length) return null;
    // split text tokens at every range edge so each piece lies in one place
    var edges = [];
    ranges.forEach(function (r) { edges.push(r.s, r.e); });
    var pieces = [];
    toks.forEach(function (t, i) {
      var a = pos[i];
      if (t.x === undefined) { pieces.push({ t: t, a: a, b: a + (t.nl ? 1 : 0) }); return; }
      var cuts = edges.filter(function (e) { return e > a && e < a + t.x.length; });
      var from = 0;
      cuts.concat([a + t.x.length]).forEach(function (e) {
        var s = t.x.slice(from, e - a);
        if (s) pieces.push({ t: { x: s }, a: a + from, b: e });
        from = e - a;
      });
    });
    for (;;) {
      // where each piece goes: segment index, or "g" + i (gap after i), "L", "T"
      var place = pieces.map(function (p) { return where(p, ranges); });
      // a pair must open and close in the same segment
      var open = {}, bad = null;
      pieces.forEach(function (p, i) {
        if (p.t.o !== undefined) open[p.t.o] = place[i];
        if (p.t.c !== undefined && open[p.t.c] !== undefined && open[p.t.c] !== place[i]) {
          var a = segIdx(open[p.t.c], ranges.length), b = segIdx(place[i], ranges.length);
          if (a !== b) bad = [Math.min(a, b), Math.max(a, b)];
        }
      });
      if (!bad) {
        var segs = ranges.map(function () { return { toks: [], sep: "" }; }), lead = "", trail = "";
        pieces.forEach(function (p, i) {
          var w = place[i];
          if (typeof w === "number") segs[w].toks.push(p.t);
          else {
            var raw = p.t.x !== undefined ? (plainMode ? p.t.x : encode(p.t.x)) : rawOf(p.t);
            if (w === "L") lead += raw;
            else if (w === "T") trail += raw;
            else segs[+w.slice(1)].sep += raw;
          }
        });
        return { lead: lead, trail: trail, segs: segs };
      }
      // merge the ranges the pair crosses and try again
      var merged = ranges.slice(0, bad[0]).concat([{ s: ranges[bad[0]].s, e: ranges[bad[1]].e }]).concat(ranges.slice(bad[1] + 1));
      ranges = merged;
    }
    function rawOf(t) { return t.raw; }
  }
  function segIdx(w, n) {
    if (typeof w === "number") return w;
    if (w === "L") return 0;
    if (w === "T") return n - 1;
    return +w.slice(1);
  }
  // piece p (offsets a..b) → segment index | "g<i>" | "L" | "T"
  function where(p, ranges) {
    var n = ranges.length, t = p.t;
    if (t.x !== undefined) {
      for (var i = 0; i < n; i++) if (p.a >= ranges[i].s && p.b <= ranges[i].e) return i;
      return gapAt(p.a, ranges);
    }
    var x = p.a;
    if (t.o !== undefined) {
      for (var j = 0; j < n; j++) if (x >= ranges[j].s && x < ranges[j].e) return j;
      for (var k = 0; k < n; k++) if (x < ranges[k].s || (x === ranges[k].s)) return k;
      return n - 1;
    }
    if (t.c !== undefined) {
      for (var q = n - 1; q >= 0; q--) if (x > ranges[q].s && x <= ranges[q].e) return q;
      for (var u = n - 1; u >= 0; u--) if (x >= ranges[u].e) return u;
      return 0;
    }
    // a piece: inside a sentence → that segment, else between them
    for (var z = 0; z < n; z++) if (x > ranges[z].s && x < ranges[z].e) return z;
    return gapAt(x, ranges);
  }
  // a position outside every sentence → "L" (before the first), "g<i>"
  // (between sentence i and i + 1) or "T" (after the last)
  function gapAt(x, ranges) {
    var n = ranges.length;
    if (x <= ranges[0].s) return "L";
    for (var i = 0; i < n - 1; i++) if (x >= ranges[i].e && x <= ranges[i + 1].s) return "g" + i;
    return "T";
  }

  // tokens of one segment → its text with local tag numbers
  function segText(toks, tags) {
    var ids = [], s = "";
    function num(id) { var i = ids.indexOf(id); if (i < 0) { ids.push(id); i = ids.length - 1; } return i + 1; }
    toks.forEach(function (t) {
      if (t.x !== undefined) s += t.x;
      else if (t.o !== undefined) s += OPEN + num(t.o) + CLOSE;
      else if (t.c !== undefined) s += OPEN + "/" + num(t.c) + CLOSE;
      else if (t.v !== undefined) s += OPEN + num(t.v) + "/" + CLOSE;
    });
    return { s: s, t: ids };
  }

  // ---------- 5. Extract a document ----------
  // doc = { html, title, header, footer, footnotes: [{id, text}] }
  // → { v, tpl, blocks: [{k, h?, id?, lead, trail, tags}], segs: [{b, s, t, sep, w}] }
  function extract(doc, lang) {
    doc = doc || {};
    var blocks = [], segs = [];
    function addRun(nodes, k, h, extra) {
      var tags = [];
      var toks = runTokens(nodes, tags);
      var plain = toks.map(function (t) { return t.x !== undefined ? t.x : (t.nl ? "\n" : ""); }).join("");
      if (!WORD_RX.test(plain)) return null;
      // raw html of pieces
      toks.forEach(function (t) { if (t.v !== undefined) t.raw = tags[t.v][1]; else if (t.o !== undefined) t.raw = tags[t.o][1]; else if (t.c !== undefined) t.raw = tags[t.c][2]; });
      var cut = cutRun(toks, lang, false);
      if (!cut) return null;
      return pushBlock(cut, tags, k, h, extra);
    }
    function pushBlock(cut, tags, k, h, extra) {
      var b = { k: k, lead: cut.lead, trail: cut.trail, tags: tags };
      if (h) b.h = h;
      if (extra) Object.keys(extra).forEach(function (x) { b[x] = extra[x]; });
      blocks.push(b);
      var bi = blocks.length - 1;
      cut.segs.forEach(function (sg) {
        var st = segText(sg.toks, tags);
        var words = Core.countWords(sg.toks.map(function (t) { return t.x || ""; }).join(""));
        segs.push({ b: bi, s: st.s, t: st.t, sep: sg.sep, w: words });
      });
      return bi;
    }
    function addPlain(text, k, extra) {
      text = String(text || "").replace(/\r\n?/g, "\n").replace(/[⟦⟧]/g, function (c) { return c === OPEN ? "[" : "]"; });
      if (!WORD_RX.test(text)) return;
      var toks = [{ x: text }];
      var cut = cutRun(toks, lang, true);
      if (cut) pushBlock(cut, [], k, 0, extra);
    }
    addPlain(doc.title, "title");
    // the html body: runs of inline nodes become markers in the template
    var tree = parse(String(doc.html || "").replace(/[]/g, ""));
    function walk(el, h) {
      if (RAW_BLOCK[el.tag]) return;
      var kids = el.kids, out = [], run = [];
      function flush() {
        if (!run.length) return;
        var bi = addRun(run, "h", h);
        if (bi === null) out.push.apply(out, run);
        else out.push({ mk: MK_A + bi + MK_B });
        run = [];
      }
      kids.forEach(function (k) {
        if (k.tag && (isBlock(k) || hasBlock(k))) {
          flush();
          walk(k, HEAD[k.tag] || h);
          out.push(k);
        } else run.push(k);
      });
      flush();
      el.kids = out;
    }
    walk(tree, 0);
    var tpl = ser(tree);
    addPlain(doc.header, "hdr");
    addPlain(doc.footer, "ftr");
    (Array.isArray(doc.footnotes) ? doc.footnotes : []).forEach(function (f) {
      if (f && typeof f.id === "string") addPlain(f.text, "fn", { id: f.id.slice(0, 80) });
    });
    if (segs.length > MAX_SEGS) segs.length = MAX_SEGS;
    return { v: VERSION, tpl: tpl, blocks: blocks, segs: segs };
  }

  // ---------- 6. Tags in a translation ----------
  // The tags a segment has: [{ n, kind "p"|"v", name }]
  function segTags(src, i) {
    var sg = src.segs[i], bl = src.blocks[sg.b];
    return sg.t.map(function (id, k) { var tg = bl.tags[id] || ["v", "", "", ""]; return { n: k + 1, kind: tg[0], name: tg[3] }; });
  }
  // text → tokens; a tag that does not belong to the segment is text
  function readTags(text, kinds) {
    var out = [], last = 0, m;
    text = String(text || "");
    TAG_RX.lastIndex = 0;
    while ((m = TAG_RX.exec(text))) {
      var n = +m[2], kind = kinds[n - 1];
      var ok = kind && ((kind === "v" && !m[1] && m[3]) || (kind === "p" && !m[3]));
      if (!ok) continue;
      if (m.index > last) out.push({ x: text.slice(last, m.index) });
      last = TAG_RX.lastIndex;
      out.push(kind === "v" ? { v: n } : (m[1] ? { c: n } : { o: n }));
    }
    if (last < text.length) out.push({ x: text.slice(last) });
    return out;
  }
  // What is wrong with the tags of a translation (for the screen):
  // { missing: [n…], twice: [n…], order: bool }
  function checkTags(src, i, text) {
    var tg = segTags(src, i), kinds = tg.map(function (x) { return x.kind; });
    var toks = readTags(text, kinds), seenO = {}, seenC = {}, seenV = {}, twice = [], order = false, stack = [];
    toks.forEach(function (t) {
      if (t.v) { if (seenV[t.v]) twice.push(t.v); seenV[t.v] = 1; }
      if (t.o) { if (seenO[t.o]) twice.push(t.o); seenO[t.o] = 1; stack.push(t.o); }
      if (t.c) {
        if (seenC[t.c]) twice.push(t.c);
        seenC[t.c] = 1;
        if (stack[stack.length - 1] !== t.c) order = true;
        var at = stack.lastIndexOf(t.c);
        if (at >= 0) stack.splice(at, 1); else order = true;
      }
    });
    if (stack.length) order = true;
    var missing = tg.filter(function (x) { return x.kind === "v" ? !seenV[x.n] : !(seenO[x.n] && seenC[x.n]); }).map(function (x) { return x.n; });
    return { missing: missing, twice: twice, order: order };
  }

  // One segment's translation → html (or plain text for plain blocks).
  // Pairs are kept well nested, a pair left open closes at the end, a
  // closing tag with nothing open is dropped, and every piece of the
  // source (a footnote number, a picture) that the translation lost is
  // put at its end, so nothing of the book is ever lost.
  function segOut(src, i, text) {
    var sg = src.segs[i], bl = src.blocks[sg.b], plain = bl.k !== "h";
    var kinds = sg.t.map(function (id) { return (bl.tags[id] || ["v"])[0]; });
    var toks = readTags(text, kinds), html = "", stack = [], usedV = {};
    function tag(n) { return bl.tags[sg.t[n - 1]]; }
    function esc(s) { return plain ? s : encode(s); }
    toks.forEach(function (t) {
      // a mark that is not one of this segment's tags is dropped (the
      // source never has ⟦ ⟧: extract turns them into [ ])
      if (t.x !== undefined) { html += esc(t.x.replace(TAG_RX, "")); return; }
      if (plain) return;
      if (t.v) { if (usedV[t.v]) return; usedV[t.v] = 1; html += tag(t.v)[1]; return; }
      if (t.o) { html += tag(t.o)[1]; stack.push(t.o); return; }
      var at = stack.lastIndexOf(t.c);
      if (at < 0) return;
      var above = stack.slice(at + 1);
      for (var k = stack.length - 1; k > at; k--) html += tag(stack[k])[2];
      html += tag(t.c)[2];
      stack.length = at;
      above.forEach(function (n) { html += tag(n)[1]; stack.push(n); });
    });
    for (var k = stack.length - 1; k >= 0; k--) html += tag(stack[k])[2];
    if (!plain) kinds.forEach(function (kd, k) { if (kd === "v" && !usedV[k + 1]) html += tag(k + 1)[1]; });
    return html;
  }

  // ---------- 7. Rows ----------
  // row = [text, status, stamp]; status 0 new, 1 draft, 2 translated, 3 reviewed
  var ST_NEW = 0, ST_DRAFT = 1, ST_DONE = 2, ST_REVIEWED = 3;
  function cleanRow(r) {
    if (!Array.isArray(r) || typeof r[0] !== "string") return null;
    var st = r[1] === 1 || r[1] === 2 || r[1] === 3 ? r[1] : 0;
    var m = Number(r[2]);
    if (!isFinite(m) || m <= 0 || Math.floor(m) !== m) return null;
    return [r[0].slice(0, MAX_TEXT), st, m];
  }
  function newer(a, b) {
    if (!a) return b; if (!b) return a;
    if (a[2] !== b[2]) return a[2] > b[2] ? a : b;
    if (a[1] !== b[1]) return a[1] > b[1] ? a : b;
    return a[0] >= b[0] ? a : b;
  }
  // { "<i>": row } × many → one map (a join: same result in any order)
  function mergeRows(list) {
    var out = {};
    (list || []).forEach(function (rows) {
      if (!rows || typeof rows !== "object") return;
      Object.keys(rows).forEach(function (k) {
        if (!/^\d{1,6}$/.test(k)) return;
        var r = cleanRow(rows[k]);
        if (r) out[k] = newer(out[k], r);
      });
    });
    return out;
  }
  // A rows file → its rows (bad files read as none)
  function readRowsFile(obj, dev, chunk) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !obj.r || typeof obj.r !== "object") return {};
    var out = {};
    Object.keys(obj.r).forEach(function (k) {
      if (!/^\d{1,6}$/.test(k) || Math.floor(+k / CHUNK) !== chunk) return;
      var r = cleanRow(obj.r[k]);
      if (r) out[k] = r;
    });
    return out;
  }
  function rowsFile(dev, rows) {
    var keys = Object.keys(rows).sort(function (a, b) { return a - b; }), r = {};
    keys.forEach(function (k) { r[k] = rows[k]; });
    return { v: 1, dev: dev, r: r };
  }
  function chunkOf(i) { return Math.floor(i / CHUNK); }
  var DEV_RX = /^[a-z0-9]{6,32}$/;
  // "rows-<dev>-<chunk>.json" → { dev, chunk } | null
  function rowsName(name) {
    var m = /^rows-([a-z0-9]{6,32})-(\d{1,4})\.json$/.exec(String(name || ""));
    return m ? { dev: m[1], chunk: +m[2] } : null;
  }
  function metaName(name) {
    var m = /^meta-([a-z0-9]{6,32})\.json$/.exec(String(name || ""));
    return m ? m[1] : null;
  }
  // meta files (name, translated document) → one meta: newer wins per field
  function mergeMeta(list) {
    var out = { name: "", nm: 0, out: "", om: 0, tm: "", tmm: 0 };
    (list || []).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      if (typeof m.name === "string" && Number(m.nm) > 0 && (m.nm > out.nm || (m.nm === out.nm && m.name > out.name))) { out.name = m.name.slice(0, 200); out.nm = m.nm; }
      if (typeof m.out === "string" && Number(m.om) > 0 && (m.om > out.om || (m.om === out.om && m.out > out.out))) { out.out = m.out.slice(0, 80); out.om = m.om; }
      // T2: the memory this project's confirmed segments go into
      if (typeof m.tm === "string" && Number(m.tmm) > 0 && (m.tmm > out.tmm || (m.tmm === out.tmm && m.tm > out.tm))) { out.tm = m.tm.slice(0, 40); out.tmm = m.tmm; }
    });
    return out;
  }

  // ---------- 8. Building the translated document ----------
  // rows: { "<i>": row }. A segment without a translation keeps its
  // source text (opts.blank: empty instead); a segment marked
  // translated with no text is empty on purpose (its words went into
  // the segment before: a join).
  function build(src, rows, opts) {
    opts = opts || {};
    rows = rows || {};
    var texts = {}, title = "", hdr = "", ftr = "", fns = [];
    src.blocks.forEach(function (b, bi) { texts[bi] = b.lead; });
    src.segs.forEach(function (sg, i) {
      var r = rows[i];
      var txt = r && (r[0].trim() || r[1] >= ST_DONE) ? r[0] : (opts.blank ? "" : sg.s);
      var o = segOut(src, i, txt);
      // an empty segment takes its space with it (a break or a footnote number stays)
      texts[sg.b] += o + (o === "" && !/\S/.test(sg.sep.replace(/&nbsp;/g, " ")) ? "" : sg.sep);
    });
    src.blocks.forEach(function (b, bi) { texts[bi] += b.trail; });
    src.blocks.forEach(function (b, bi) {
      if (b.k === "title") title = texts[bi];
      else if (b.k === "hdr") hdr = texts[bi];
      else if (b.k === "ftr") ftr = texts[bi];
      else if (b.k === "fn") fns.push({ id: b.id, text: texts[bi] });
    });
    var html = String(src.tpl || "").replace(/(\d+)/g, function (m, n) { return texts[+n] !== undefined ? texts[+n] : ""; });
    return { title: title, html: html, header: hdr, footer: ftr, footnotes: fns };
  }

  // ---------- 9. Progress ----------
  // → { segs, words, done, doneWords, draft, reviewed, pct }
  function stats(src, rows) {
    var o = { segs: src.segs.length, words: 0, done: 0, doneWords: 0, draft: 0, reviewed: 0, pct: 0 };
    src.segs.forEach(function (sg, i) {
      o.words += sg.w;
      var r = rows && rows[i], st = r ? (r[0].trim() ? r[1] : (r[1] >= ST_DONE ? r[1] : 0)) : 0;
      if (st >= ST_DONE) { o.done++; o.doneWords += sg.w; }
      if (st === ST_REVIEWED) o.reviewed++;
      if (st === ST_DRAFT) o.draft++;
    });
    o.pct = o.words ? Math.floor(o.doneWords * 1000 / o.words) / 10 : (o.segs && o.done === o.segs ? 100 : 0);
    return o;
  }
  // Chapters = the segments of h1/h2 headings: [{ i (first segment), title }]
  function chapters(src) {
    var out = [], lastB = -1;
    src.segs.forEach(function (sg, i) {
      var b = src.blocks[sg.b];
      if (sg.b !== lastB && b.k === "h" && (b.h === 1 || b.h === 2)) out.push({ i: i, title: plainText(src, i) });
      lastB = sg.b;
    });
    return out;
  }
  // a segment's source without tags
  function plainText(src, i) { return String(src.segs[i].s).replace(TAG_RX, ""); }
  // The same source text more than once: i → first i with that text
  function repeats(src) {
    var first = {}, out = {};
    src.segs.forEach(function (sg, i) {
      var k = sg.s.trim();
      if (first[k] === undefined) first[k] = i; else out[i] = first[k];
    });
    return out;
  }

  // A src.json read from the disk → a src or null (never trust a file)
  function readSrc(obj) {
    if (!obj || typeof obj !== "object" || obj.v !== VERSION || typeof obj.tpl !== "string" ||
        !Array.isArray(obj.blocks) || !Array.isArray(obj.segs) || obj.segs.length > MAX_SEGS) return null;
    var blocks = [], ok = true;
    obj.blocks.forEach(function (b) {
      if (!b || typeof b !== "object" || ["h", "title", "hdr", "ftr", "fn"].indexOf(b.k) < 0 ||
          typeof b.lead !== "string" || typeof b.trail !== "string" || !Array.isArray(b.tags)) { ok = false; return; }
      var tags = b.tags.map(function (t) {
        return Array.isArray(t) && (t[0] === "p" || t[0] === "v") && typeof t[1] === "string" ? [t[0], t[1], String(t[2] || ""), String(t[3] || "")] : ["v", "", "", ""];
      });
      var nb = { k: b.k, lead: b.lead, trail: b.trail, tags: tags };
      if (HEAD["h" + b.h]) nb.h = b.h;
      if (b.k === "fn") nb.id = String(b.id || "").slice(0, 80);
      blocks.push(nb);
    });
    if (!ok) return null;
    var segs = [];
    obj.segs.forEach(function (s) {
      if (!s || typeof s !== "object" || typeof s.s !== "string" || !(s.b >= 0 && s.b < blocks.length) || !Array.isArray(s.t)) { ok = false; return; }
      var t = s.t.filter(function (x) { return x >= 0 && x < blocks[s.b].tags.length && Math.floor(x) === x; });
      segs.push({ b: s.b, s: s.s, t: t, sep: typeof s.sep === "string" ? s.sep : "", w: Math.max(0, Math.floor(Number(s.w) || 0)) });
    });
    if (!ok) return null;
    var out = { v: VERSION, tpl: obj.tpl, blocks: blocks, segs: segs };
    if (obj.page && typeof obj.page === "object") out.page = obj.page;
    return out;
  }
  // project.json → its fields or null
  var ID_RX = /^tr[a-z0-9]{6,30}$/;
  function readProject(obj) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !ID_RX.test(String(obj.id || ""))) return null;
    return {
      v: 1, id: obj.id, name: String(obj.name || "").slice(0, 200), from: cleanLang(obj.from), to: cleanLang(obj.to),
      at: Number(obj.at) > 0 ? Math.floor(obj.at) : 0, src: typeof obj.src === "string" ? obj.src.slice(0, 80) : "",
      file: typeof obj.file === "string" ? obj.file.slice(0, 200) : ""
    };
  }
  function newId(now, rnd) {
    return "tr" + Math.floor(now).toString(36) + Math.floor(rnd * 1e9).toString(36).padStart(6, "0").slice(0, 6);
  }

  var api = {
    VERSION: VERSION, CHUNK: CHUNK, MAX_TEXT: MAX_TEXT, LANGS: LANGS, OPEN: OPEN, CLOSE: CLOSE,
    ST_NEW: ST_NEW, ST_DRAFT: ST_DRAFT, ST_DONE: ST_DONE, ST_REVIEWED: ST_REVIEWED, DEV_RX: DEV_RX, ID_RX: ID_RX,
    cleanLang: cleanLang, extract: extract, build: build, segOut: segOut, segTags: segTags, readTags: readTags,
    checkTags: checkTags, mergeRows: mergeRows, readRowsFile: readRowsFile, rowsFile: rowsFile, chunkOf: chunkOf,
    rowsName: rowsName, metaName: metaName, mergeMeta: mergeMeta, stats: stats, chapters: chapters,
    plainText: plainText, repeats: repeats, readSrc: readSrc, readProject: readProject, newId: newId, cleanRow: cleanRow,
    sentences: sentences
  };
  if (node) module.exports = api;
  else root.WriterCatCore = api;
})(this);
