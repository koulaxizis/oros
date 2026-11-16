// ============================================================
// orOS Writer — catdocx.js: book translation straight into the Word
// file (WR-CAT, wave T4). Pure: no DOM, no storage. Tested in Node
// (tests/writer-catdocx.test.js).
// A project made from a .docx is cut from the Word paragraphs
// themselves (word/document.xml, headers, footers, footnotes,
// endnotes), not from Writer's import, so the translation goes back
// into the original package and only the text changes: styles,
// numbering, pictures, sections, tables, fields and every other part
// stay byte for byte.
//   - a run whose formatting differs from the paragraph's usual one
//     becomes a pair tag (its w:rPr is kept and put on the translated
//     words); a hyperlink, a tracked insertion, a content control, a
//     simple field and a field with its result become pair tags with
//     their own XML around the words
//   - a picture, a tab, a break, a footnote number, a bookmark, a
//     deletion, an equation and a field without words become pieces
//     kept as they are
//   - a field that runs over several paragraphs (a table of contents)
//     and text boxes stay as they are (Word updates a contents table)
//   - w:lang of the translated paragraphs and the styles becomes the
//     target language, so Word checks the spelling in it
// extract(entries, lang) → src (catcore form, fmt "docx") | null
// build(src, rows, entries, opts) → entries with the changed parts
// entries = [{ name, data: Uint8Array }] (the unzipped package)
// Exposes window.WriterCatDocx (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./catcore.js") : root.WriterCatCore;

  var MAX_PART = 48 * 1024 * 1024;
  var W_NS = /xmlns:w="(http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/wordprocessingml\/main)"/;
  var PART_RX = /^word\/(document|header\d{0,3}|footer\d{0,3}|footnotes|endnotes)\.xml$/;
  var TOK = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
  var WORD_RX = C.WORD_RX, TAG_RX = C.TAG_RX;

  function err(code) { var e = new Error(code); e.code = code; return e; }
  function decodeX(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|lt|gt|amp|quot|apos);/g, function (m, e) {
      if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "amp") return "&";
      if (e === "quot") return "\""; if (e === "apos") return "'";
      var n = e.charAt(1) === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : "";
    });
  }
  function escX(s) {
    // characters XML 1.0 does not allow are left out
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attrOf(attrs, name) {
    var m = new RegExp("\\s" + name.replace(/[.:]/g, "\\$&") + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')").exec(attrs || "");
    return m ? decodeX(m[2] !== undefined ? m[2] : m[3]) : null;
  }
  // FNV-1a of a part's text, so build() knows the file is the same one
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  function utf8(b) { return new TextDecoder("utf-8").decode(b); }
  function bytes(s) { return new TextEncoder().encode(s); }

  // ---------- 1. The paragraphs of a part ----------
  // Top-level <w:p> only (a paragraph inside a text box belongs to its
  // picture): [{ s, e, note }] offsets in the part's text.
  function paras(s) {
    var out = [], depth = 0, start = -1, note = null, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(s))) {
      if (m[0] === "<!DOCTYPE") throw err("dtd");
      var name = m[2];
      if (!name) continue;
      if (!m[1] && (name === "w:footnote" || name === "w:endnote")) note = (name === "w:endnote" ? "e" : "") + (attrOf(m[3], "w:id") || "");
      if (name !== "w:p") continue;
      if (m[1]) {
        if (depth > 0) depth--;
        if (depth === 0 && start >= 0) { out.push({ s: start, e: TOK.lastIndex, note: note }); start = -1; }
      } else if (!m[4]) {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return out;
  }
  // One element and what is inside: { n, s, oe, cs, e, sc, kids }
  function tree(s, a, b) {
    var top = { n: "#", kids: [] }, stack = [top], re = new RegExp(TOK.source, "g"), m;
    re.lastIndex = a;
    while ((m = re.exec(s)) && m.index < b) {
      var cur = stack[stack.length - 1], name = m[2];
      if (!name) continue;
      if (m[1]) {
        for (var k = stack.length - 1; k > 0; k--) if (stack[k].n === name) { stack[k].cs = m.index; stack[k].e = re.lastIndex; stack.length = k; break; }
        continue;
      }
      var nd = { n: name, s: m.index, oe: re.lastIndex, kids: [] };
      cur.kids.push(nd);
      if (m[4]) { nd.sc = 1; nd.cs = nd.oe; nd.e = nd.oe; } else stack.push(nd);
    }
    for (var j = stack.length - 1; j > 0; j--) { stack[j].cs = b; stack[j].e = b; }
    return top.kids[0];
  }
  function raw(s, nd) { return s.slice(nd.s, nd.e); }
  function inner(s, nd) { return nd.sc ? "" : s.slice(nd.oe, nd.cs); }
  function child(nd, name) { for (var i = 0; i < nd.kids.length; i++) if (nd.kids[i].n === name) return nd.kids[i]; return null; }

  // ---------- 2. A paragraph → items ----------
  // { type: "text", x, rpr, raw } | { type: "void", raw, name, nl }
  // | { type: "fld", ft, raw } | { type: "instr", raw }
  // | { type: "wrap", name, open, close, raw, kids: [items] }
  var WRAP = { "w:hyperlink": "a", "w:ins": "ins", "w:moveTo": "ins", "w:smartTag": "tag", "w:customXml": "tag",
    "w:fldSimple": "field", "w:dir": "dir", "w:bdo": "dir", "w:sdt": "box" };
  var SKIP = { "w:pPr": 1, "w:proofErr": 1, "w:lastRenderedPageBreak": 1, "w:softHyphen": 1, "w:rPr": 1 };
  var PIECE = { "w:tab": "tab", "w:ptab": "tab", "w:cr": "br", "w:drawing": "img", "w:pict": "img", "w:object": "img",
    "mc:AlternateContent": "img", "w:footnoteReference": "fn", "w:endnoteReference": "fn", "w:footnoteRef": "fn",
    "w:endnoteRef": "fn", "w:sym": "sym", "w:bookmarkStart": "mark", "w:bookmarkEnd": "mark", "w:del": "del",
    "w:moveFrom": "del", "m:oMath": "math", "m:oMathPara": "math", "w:commentRangeStart": "note",
    "w:commentRangeEnd": "note", "w:commentReference": "note" };
  function shortName(n) { return PIECE[n] || String(n).replace(/^\w+:/, "").slice(0, 12); }

  function itemsOf(s, kids) {
    var items = [];
    kids.forEach(function (k) {
      var n = k.n;
      if (SKIP[n]) return;
      if (n === "w:r") { runItems(s, k, items); return; }
      if (WRAP[n] && !k.sc) {
        var open, close, list = k.kids;
        if (n === "w:sdt") {
          var sc = child(k, "w:sdtContent");
          if (!sc || sc.sc) { items.push({ type: "void", raw: raw(s, k), name: "box", nl: 0 }); return; }
          open = s.slice(k.s, sc.oe); close = s.slice(sc.cs, k.e); list = sc.kids;
        } else if (n === "w:smartTag" || n === "w:customXml") {
          var pr = child(k, n + "Pr");
          open = s.slice(k.s, pr ? pr.e : k.oe); close = s.slice(k.cs, k.e);
          list = k.kids.filter(function (x) { return x !== pr; });
        } else { open = s.slice(k.s, k.oe); close = s.slice(k.cs, k.e); }
        items.push({ type: "wrap", name: WRAP[n], open: open, close: close, raw: raw(s, k), kids: itemsOf(s, list) });
        return;
      }
      items.push({ type: "void", raw: raw(s, k), name: shortName(n), nl: 0 });
    });
    return items;
  }
  function runItems(s, r, items) {
    if (r.sc) return;
    var rp = child(r, "w:rPr"), rpr = rp ? raw(s, rp) : "", ro = s.slice(r.s, r.oe);
    function wrapped(nd) { return ro + rpr + raw(s, nd) + "</w:r>"; }
    r.kids.forEach(function (k) {
      var n = k.n;
      if (SKIP[n]) return;
      if (n === "w:t") {
        var x = decodeX(inner(s, k)).replace(/[⟦⟧]/g, function (c) { return c === "⟦" ? "[" : "]"; });
        if (x) items.push({ type: "text", x: x, rpr: rpr, raw: wrapped(k) });
        return;
      }
      if (n === "w:noBreakHyphen") { items.push({ type: "text", x: "\u2011", rpr: rpr, raw: wrapped(k) }); return; }
      if (n === "w:fldChar") { items.push({ type: "fld", ft: attrOf(s.slice(k.s, k.oe), "w:fldCharType") || "", raw: wrapped(k) }); return; }
      if (n === "w:instrText") { items.push({ type: "instr", raw: wrapped(k) }); return; }
      if (n === "w:br") {
        var bt = attrOf(s.slice(k.s, k.oe), "w:type");
        items.push({ type: "void", raw: wrapped(k), name: bt === "page" || bt === "column" ? "page" : "br", nl: 1 });
        return;
      }
      items.push({ type: "void", raw: wrapped(k), name: shortName(n), nl: n === "w:cr" ? 1 : 0 });
    });
  }

  // Fields: begin … separate … end. With words in the result and no
  // field inside, the field is a pair around its result; else a piece.
  // carry: { d } (top level only) for a field still open from an
  // earlier paragraph. A wrapper with a field end it does not hold
  // becomes one piece, so nothing can move a field's end before its
  // beginning.
  function rawOf(it) { return it.raw; }
  function fields(items, carry) {
    var out = [], i = 0, bad = false;
    if (carry && carry.d > 0) {
      var r0 = "";
      while (i < items.length && carry.d > 0) {
        var a = items[i++];
        r0 += a.raw;
        if (a.type === "fld") { if (a.ft === "begin") carry.d++; else if (a.ft === "end") carry.d--; }
        else if (a.type === "wrap" && /w:fldChar/.test(a.raw)) carry.d += fldDelta(a.raw);
      }
      if (carry.d < 0) carry.d = 0;
      if (r0) out.push({ type: "void", raw: r0, name: "field", nl: 0 });
    }
    while (i < items.length) {
      var it = items[i];
      if (it.type === "wrap") {
        var sub = fields(it.kids, null);
        if (sub.bad) { out.push({ type: "void", raw: it.raw, name: it.name, nl: 0 }); if (carry) carry.d += fldDelta(it.raw); }
        else { it.kids = sub.items; out.push(it); }
        i++; continue;
      }
      if (it.type === "instr") { out.push({ type: "void", raw: it.raw, name: "field", nl: 0 }); i++; continue; }
      if (it.type !== "fld") { out.push(it); i++; continue; }
      if (it.ft !== "begin") {
        // the end of a field begun in a wrapper before: still one piece each
        if (carry && it.ft === "end" && carry.d > 0) carry.d--; else bad = true;
        out.push({ type: "void", raw: it.raw, name: "field", nl: 0 }); i++; continue;
      }
      var d = 0, sep = -1, end = -1, nested = false;
      for (var j = i; j < items.length; j++) {
        var x = items[j];
        if (x.type === "wrap" && /w:fldChar/.test(x.raw)) nested = true;
        if (x.type !== "fld") continue;
        if (x.ft === "begin") { d++; if (d > 1) nested = true; }
        else if (x.ft === "end") { d--; if (d === 0) { end = j; break; } }
        else if (x.ft === "separate" && d === 1) sep = j;
      }
      if (end < 0) {
        out.push({ type: "void", raw: items.slice(i).map(rawOf).join(""), name: "field", nl: 0 });
        if (carry) carry.d += d; else bad = true;
        break;
      }
      var res = sep >= 0 ? items.slice(sep + 1, end) : [];
      var words = res.filter(function (r) { return r.type === "text"; }).map(function (r) { return r.x; }).join("");
      if (sep >= 0 && !nested && WORD_RX.test(words) && res.every(function (r) { return r.type === "text" || r.type === "void"; })) {
        out.push({ type: "wrap", name: "field", open: items.slice(i, sep + 1).map(rawOf).join(""), close: items[end].raw,
          raw: items.slice(i, end + 1).map(rawOf).join(""), kids: res });
      } else out.push({ type: "void", raw: items.slice(i, end + 1).map(rawOf).join(""), name: "field", nl: 0 });
      i = end + 1;
    }
    return carry ? out : { items: out, bad: bad };
  }
  function fldDelta(x) {
    var b = (x.match(/w:fldCharType\s*=\s*["']begin["']/g) || []).length, e = (x.match(/w:fldCharType\s*=\s*["']end["']/g) || []).length;
    return b - e;
  }

  // ---------- 3. Items → tokens and tags ----------
  // The formatting most of the text has is the paragraph's (or the
  // wrapper's) own; a run that differs is a pair tag. Language and
  // spelling marks do not count as formatting.
  function rkey(rpr) {
    return String(rpr || "").replace(/<w:lang\b[^>]*\/>/g, "").replace(/<w:noProof\b[^>]*\/>/g, "")
      .replace(/\s+w:hint="[^"]*"/g, "").replace(/<w:rFonts\s*\/>/g, "").replace(/^<w:rPr>\s*<\/w:rPr>$|^<w:rPr\s*\/>$/, "");
  }
  function on(rpr, tag) {
    var m = new RegExp("<w:" + tag + "(\\s[^>]*)?/>").exec(rpr);
    if (!m) return false;
    var v = attrOf(m[1] || "", "w:val");
    return v === null || !/^(0|false|off|none)$/i.test(v);
  }
  function fmtName(rpr) {
    if (on(rpr, "b")) return "b";
    if (on(rpr, "i")) return "i";
    if (on(rpr, "u")) return "u";
    if (on(rpr, "strike") || on(rpr, "dstrike")) return "s";
    var va = /<w:vertAlign\s[^>]*w:val="(superscript|subscript)"/.exec(rpr);
    if (va) return va[1] === "superscript" ? "sup" : "sub";
    if (on(rpr, "smallCaps") || on(rpr, "caps")) return "caps";
    if (/<w:(color|highlight|shd)\b/.test(rpr)) return "color";
    if (/<w:rStyle\b/.test(rpr)) return "style";
    return "fmt";
  }
  function baseOf(items) {
    var cnt = {}, xml = {}, best = null;
    items.forEach(function (it) {
      if (it.type !== "text") return;
      var k = rkey(it.rpr);
      cnt[k] = (cnt[k] || 0) + it.x.length;
      if (xml[k] === undefined) xml[k] = it.rpr;
    });
    Object.keys(cnt).forEach(function (k) { if (best === null || cnt[k] > cnt[best]) best = k; });
    return best === null ? { k: "", x: "" } : { k: best, x: xml[best] };
  }
  function toks(items, tags, out) {
    var base = baseOf(items);
    function piece(rw, name, nl) { tags.push(["v", rw, "", name, ""]); out.push({ v: tags.length - 1, nl: nl ? 1 : 0, raw: rw }); }
    var i = 0;
    while (i < items.length) {
      var it = items[i];
      if (it.type === "text") {
        var k = rkey(it.rpr), j = i, txt = "", rw = "";
        while (j < items.length && items[j].type === "text" && rkey(items[j].rpr) === k) { txt += items[j].x; rw += items[j].raw; j++; }
        if (k === base.k || !/\S/.test(txt)) out.push({ x: txt });
        else if (WORD_RX.test(txt)) {
          tags.push(["p", "", "", fmtName(it.rpr), it.rpr]);
          var id = tags.length - 1;
          out.push({ o: id, raw: "" }, { x: txt }, { c: id, raw: "" });
        } else piece(rw, "fmt", 0);
        i = j;
        continue;
      }
      if (it.type === "wrap") {
        if (!WORD_RX.test(textOf(it.kids))) { piece(it.raw, it.name, /w:br\b|w:cr\b/.test(it.raw)); i++; continue; }
        var at = tags.length;
        tags.push(["p", it.open, it.close, it.name, ""]);
        out.push({ o: at, raw: it.open });
        tags[at][4] = toks(it.kids, tags, out).x;
        out.push({ c: at, raw: it.close });
        i++;
        continue;
      }
      piece(it.raw, it.name, it.nl);
      i++;
    }
    return base;
  }
  function textOf(items) {
    return items.map(function (it) { return it.type === "text" ? it.x : it.type === "wrap" ? textOf(it.kids) : ""; }).join("");
  }
  // a text written as a run (\n a line break, \t a tab)
  function runXml(rpr, text) {
    text = String(text || "").replace(TAG_RX, "");
    if (!text) return "";
    var out = "<w:r>" + (rpr || "");
    text.split(/(\n|\t)/).forEach(function (p) {
      if (p === "\n") out += "<w:br/>";
      else if (p === "\t") out += "<w:tab/>";
      else if (p) out += "<w:t xml:space=\"preserve\">" + escX(p) + "</w:t>";
    });
    return out + "</w:r>";
  }

  // ---------- 4. Extract ----------
  function styleLevels(entries) {
    var st = find(entries, "word/styles.xml"), out = {};
    if (!st) return out;
    var s = utf8(st.data), re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g, m;
    while ((m = re.exec(s))) {
      var id = attrOf(m[1], "w:styleId"), nm = /<w:name\s[^>]*w:val="([^"]*)"/.exec(m[2]);
      var lv = /<w:outlineLvl\s[^>]*w:val="(\d)"/.exec(m[2]);
      if (!id) continue;
      var name = nm ? nm[1].toLowerCase() : "", h = /^heading ([1-6])$/.exec(name);
      if (h) out[id] = +h[1];
      else if (name === "title") out[id] = 1;
      else if (lv && +lv[1] < 6) out[id] = +lv[1] + 1;
    }
    return out;
  }
  function find(entries, name) { for (var i = 0; i < entries.length; i++) if (entries[i].name === name) return entries[i]; return null; }
  function partOrder(name) {
    var m = PART_RX.exec(name), k = m[1].replace(/\d+$/, ""), n = +(m[1].replace(/^\D+/, "") || 0);
    return ({ document: 0, header: 1, footer: 2, footnotes: 3, endnotes: 4 })[k] * 10000 + n;
  }
  function kindOf(name) {
    var k = PART_RX.exec(name)[1].replace(/\d+$/, "");
    return k === "document" ? "h" : k === "header" ? "hdr" : k === "footer" ? "ftr" : "fn";
  }
  function headLevel(s, p, levels) {
    if (!p) return 0;
    var x = raw(s, p), ps = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(x);
    if (ps && levels[decodeX(ps[1])]) return levels[decodeX(ps[1])];
    var ol = /<w:outlineLvl\s[^>]*w:val="(\d)"/.exec(x);
    return ol && +ol[1] < 6 ? +ol[1] + 1 : 0;
  }
  function readPart(e) {
    if (!e || !e.data || e.data.length > MAX_PART) return null;
    var s = utf8(e.data);
    if (/^\uFEFF?<\?xml[^>]*encoding="(?!utf-8)[^"]*"/i.test(s)) return null;
    return s;
  }

  function extract(entries, lang) {
    entries = entries || [];
    var doc = readPart(find(entries, "word/document.xml"));
    if (!doc || !W_NS.test(doc.slice(0, 4096))) return null;
    var levels = styleLevels(entries);
    var names = entries.map(function (e) { return e.name; }).filter(function (n) { return PART_RX.test(n); })
      .sort(function (a, b) { return partOrder(a) - partOrder(b); });
    var parts = [], blocks = [], segs = [];
    names.forEach(function (name) {
      var s = name === "word/document.xml" ? doc : readPart(find(entries, name));
      if (!s || !W_NS.test(s.slice(0, 4096))) return;
      var pi = parts.length, kind = kindOf(name), carry = { d: 0 };
      parts.push([name, s.length, hash(s)]);
      paras(s).forEach(function (p, k) {
        var nd = tree(s, p.s, p.e);
        if (!nd) return;
        var items = fields(itemsOf(s, nd.kids), carry);
        var tags = [], tk = [];
        var base = toks(items, tags, tk);
        var plain = tk.map(function (t) { return t.x !== undefined ? t.x : (t.nl ? "\n" : ""); }).join("");
        if (!WORD_RX.test(plain)) return;
        var cut = C.cutRun(tk, lang, function (x) { return runXml(base.x, x); });
        if (!cut) return;
        var b = { k: kind, lead: cut.lead, trail: cut.trail, tags: tags, x: [pi, k], base: base.x };
        var h = kind === "h" ? headLevel(s, child(nd, "w:pPr"), levels) : 0;
        if (h) b.h = h;
        if (kind === "fn") b.id = String(p.note || "").slice(0, 80);
        blocks.push(b);
        var bi = blocks.length - 1;
        cut.segs.forEach(function (sg) {
          var st = C.segText(sg.toks, tags);
          segs.push({ b: bi, s: st.s, t: st.t, sep: sg.sep, w: C.countWords(sg.toks.map(function (t) { return t.x || ""; }).join("")) });
        });
      });
    });
    if (!segs.length) return null;
    return { v: C.VERSION, fmt: "docx", tpl: "", parts: parts, blocks: blocks, segs: segs };
  }

  // ---------- 5. One segment's translation → Word XML ----------
  // As catcore.segOut: pairs stay nested, a pair left open closes at
  // the end, a close with nothing open is dropped, a piece the
  // translation lost is put at its end.
  function segXml(src, i, text) {
    var sg = src.segs[i], bl = src.blocks[sg.b];
    var kinds = sg.t.map(function (id) { return (bl.tags[id] || ["v"])[0]; });
    var tk = C.readTags(text, kinds), out = "", stack = [], usedV = {};
    function tag(n) { return bl.tags[sg.t[n - 1]] || ["v", "", "", "", ""]; }
    function rprNow() { return stack.length ? tag(stack[stack.length - 1])[4] : bl.base; }
    function openOf(n) { return tag(n)[1]; }        // a run format opens nothing
    function closeOf(n) { return tag(n)[1] ? tag(n)[2] : ""; }
    tk.forEach(function (t) {
      if (t.x !== undefined) { out += runXml(rprNow(), t.x); return; }
      if (t.v) { if (usedV[t.v]) return; usedV[t.v] = 1; out += tag(t.v)[1]; return; }
      if (t.o) {
        // a run format inside a run format: the inner one wins (Word has no nesting there)
        out += openOf(t.o); stack.push(t.o); return;
      }
      var at = stack.lastIndexOf(t.c);
      if (at < 0) return;
      var above = stack.slice(at + 1);
      for (var k = stack.length - 1; k > at; k--) out += closeOf(stack[k]);
      out += closeOf(t.c);
      stack.length = at;
      above.forEach(function (n) { out += openOf(n); stack.push(n); });
    });
    for (var k = stack.length - 1; k >= 0; k--) out += closeOf(stack[k]);
    kinds.forEach(function (kd, k) { if (kd === "v" && !usedV[k + 1]) out += tag(k + 1)[1]; });
    return out;
  }

  // ---------- 6. Build the translated package ----------
  // Word's language code for a project language
  var WLANG = { en: "en-US", el: "el-GR", de: "de-DE", fr: "fr-FR", it: "it-IT", es: "es-ES", pt: "pt-PT", nl: "nl-NL",
    sv: "sv-SE", da: "da-DK", no: "nb-NO", nb: "nb-NO", fi: "fi-FI", pl: "pl-PL", cs: "cs-CZ", ro: "ro-RO", bg: "bg-BG",
    sq: "sq-AL", sr: "sr-Latn-RS", tr: "tr-TR", ru: "ru-RU", uk: "uk-UA", ar: "ar-SA", he: "he-IL", zh: "zh-CN",
    ja: "ja-JP", ko: "ko-KR" };
  function wordLang(code) {
    code = String(code || "");
    if (/-/.test(code)) return code;
    return WLANG[code] || code;
  }
  function relang(x, from, to) {
    if (!from || !to) return x;
    var fb = String(from).split("-")[0].toLowerCase(), code = wordLang(to);
    return x.replace(/(<w:lang\b[^>]*?\sw:val=")([^"]*)(")/g, function (m, a, v, b) {
      return v.split("-")[0].toLowerCase() === fb ? a + escX(code) + b : m;
    });
  }
  function plainX(x) { return decodeX(String(x).replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "").replace(/<[^>]*>/g, "")); }

  // opts: { blank (untranslated segments empty instead of the source),
  // from, to }. Throws "changed" when the package is not the one the
  // project was made from.
  function build(src, rows, entries, opts) {
    opts = opts || {};
    rows = rows || {};
    if (!src || src.fmt !== "docx") throw err("notdocx");
    var texts = {};
    src.blocks.forEach(function (b, bi) { texts[bi] = b.lead; });
    src.segs.forEach(function (sg, i) {
      var r = rows[i];
      var txt = r && (r[0].trim() || r[1] >= C.ST_DONE) ? r[0] : (opts.blank ? "" : sg.s);
      var o = segXml(src, i, txt);
      texts[sg.b] += o + (o === "" && !/\S/.test(plainX(sg.sep)) ? "" : sg.sep);
    });
    src.blocks.forEach(function (b, bi) { texts[bi] += b.trail; });
    var perPart = {};
    src.blocks.forEach(function (b, bi) { (perPart[b.x[0]] = perPart[b.x[0]] || {})[b.x[1]] = bi; });
    var out = entries.slice(), at = {};
    out.forEach(function (e, k) { at[e.name] = k; });
    src.parts.forEach(function (pt, pi) {
      var k = at[pt[0]];
      if (k === undefined) throw err("changed");
      var s = utf8(out[k].data);
      if (s.length !== pt[1] || hash(s) !== pt[2]) throw err("changed");
      var map = perPart[pi];
      if (!map) return;
      var res = "", last = 0;
      paras(s).forEach(function (p, n) {
        var bi = map[n];
        if (bi === undefined) return;
        var nd = tree(s, p.s, p.e), ppr = child(nd, "w:pPr");
        var np = s.slice(nd.s, nd.oe) + (ppr ? raw(s, ppr) : "") + texts[bi] + "</w:p>";
        res += s.slice(last, p.s) + relang(np, opts.from, opts.to);
        last = p.e;
      });
      res += s.slice(last);
      out[k] = { name: pt[0], data: bytes(res) };
    });
    // the styles speak the new language; Word checks the spelling again
    var sk = at["word/styles.xml"];
    if (sk !== undefined && opts.to) {
      var ss = utf8(out[sk].data), ns = relang(ss, opts.from, opts.to);
      if (ns !== ss) out[sk] = { name: "word/styles.xml", data: bytes(ns) };
    }
    var gk = at["word/settings.xml"];
    if (gk !== undefined) {
      var gs = utf8(out[gk].data), ng = gs.replace(/<w:proofState\b[^>]*\/>/g, "");
      if (ng !== gs) out[gk] = { name: "word/settings.xml", data: bytes(ng) };
    }
    return out;
  }
  // "book.docx" + "el" → "book.el.docx"
  function outName(file, to) {
    var b = String(file || "translation").replace(/\.docx$/i, "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "translation";
    return b + "." + String(to || "x").replace(/[^A-Za-z0-9-]/g, "") + ".docx";
  }

  var api = { extract: extract, build: build, segXml: segXml, outName: outName, wordLang: wordLang, _paras: paras, _hash: hash };
  if (node) module.exports = api;
  else root.WriterCatDocx = api;
})(this);
