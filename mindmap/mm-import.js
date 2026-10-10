// ============================================================
// orOS Mind Map — import of other apps' files (v1.0.0)
// DOM-free, so the browser app and `node --test` run the same code.
//   1. Helpers (links, colours, icons)
//   2. FreeMind / Freeplane (.mm, XML)
//   3. A tiny read-only ZIP reader
//   4. XMind (.xmind: Zen/2020+ content.json, XMind 8 content.xml)
//   5. sniff (zip / xml)
// Every XML file goes through MMCore.readXml: one reader for the
// whole app, and it never expands entities (no billion laughs, no
// external entities). Nothing here builds markup.
// Result (all parsers): { ok: true, tree } or { ok: false, err }
// with err "size" | "format" | "empty" (and "zip" for XMind).
// tree = mm-core's plain tree, extended; every node is
//   { text, done, note, kids[], url, color, emoji, ref }
// ref = the node's id in the source file (or ""). The root also has
//   links: [{ from: ref, to: ref, label }]  (FreeMind arrow links,
//          XMind relationships; only when both ends were imported)
// and, for XMind, sheets: the number of sheets in the file (only the
// first one is imported).
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./mm-core.js") : root.MMCore;

  var TEXT_LEN   = C.TEXT_LEN;
  var NOTE_LEN   = C.NOTE_LEN;
  var URL_LEN    = C.URL_LEN;
  var MAX_NODES  = C.MAX_NODES;
  var IMPORT_MAX = C.IMPORT_MAX;          // inflated / text bytes
  var DEPTH      = 100;                   // = mm-core's MAX_DEPTH (not exported)
  var LABEL_LEN  = 200;
  var REF_LEN    = 200;
  var FILE_MAX   = 100 * 1024 * 1024;     // a whole .xmind (images included)

  // ---------- 1. Helpers ----------
  function dict() { return Object.create(null); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function xnode(text) {
    return { text: text, done: false, note: "", kids: [], url: "", color: "", emoji: "", ref: "" };
  }
  function fail(err) { return { ok: false, err: err }; }
  // Element name without its namespace prefix ("xhtml:p" → "p").
  function local(name) { var i = name.indexOf(":"); return i < 0 ? name : name.slice(i + 1); }
  function kidsNamed(el, name) {
    return el ? el.kids.filter(function (k) { return local(k.name) === name; }) : [];
  }
  function first(el, name) { return kidsNamed(el, name)[0] || null; }
  function str(v) { return typeof v === "string" ? v : ""; }
  function ref(v) { return typeof v === "string" || typeof v === "number" ? C.line(String(v), REF_LEN) : ""; }

  // Web links only: http(s) or "www.…". Local files, mailto:,
  // javascript:, links into the map itself… are dropped.
  function webUrl(raw) {
    var s = C.line(str(raw), URL_LEN);
    if (!/^https?:\/\//i.test(s) && !/^www\.[^\s\/]+\.[^\s\/]/i.test(s)) return "";
    var u = C.cleanUrl(s);
    return C.validUrl(u) ? u : "";
  }

  // "#rgb" / "#rrggbb" → the nearest branch colour key, or "" for
  // black, white and greys (those are every app's defaults).
  var RGB = dict();
  C.COLOR_KEYS.forEach(function (k) {
    var h = C.COLORS[k];
    RGB[k] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  });
  function nearestColor(hex) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(C.line(str(hex), 16));
    if (!m) return "";
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    var c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 48) return "";
    var best = "", bd = Infinity;
    C.COLOR_KEYS.forEach(function (k) {
      if (k === "grey") return;
      var r = RGB[k], d = (r[0] - c[0]) * (r[0] - c[0]) + (r[1] - c[1]) * (r[1] - c[1]) + (r[2] - c[2]) * (r[2] - c[2]);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  // A few FreeMind built-in icons and XMind markers have an obvious
  // emoji; "done" ticks become done: true. Everything else is dropped.
  var FM_ICONS = {
    idea: "\uD83D\uDCA1", help: "\u2753", yes: "\u2757", messagebox_warning: "\u26A0\uFE0F",
    stop: "\uD83D\uDED1", "stop-sign": "\uD83D\uDED1", button_cancel: "\u274C", flag: "\uD83D\uDEA9",
    bookmark: "\uD83D\uDD16", password: "\uD83D\uDD11", clock: "\u23F0", calendar: "\uD83D\uDCC5",
    attach: "\uD83D\uDCCE", launch: "\uD83D\uDE80", pencil: "\u270F\uFE0F", list: "\uD83D\uDCCB",
    ksmiletris: "\uD83D\uDE42", smily_bad: "\uD83D\uDE41", bee: "\uD83D\uDC1D", info: "\u2139\uFE0F"
  };
  var FM_DONE = { button_ok: 1 };
  var PICTURE = "\uD83D\uDDBC\uFE0F";
  function xmMarker(id) {
    var m;
    if (id === "task-done") return { done: true };
    if ((m = /^priority-([1-9])$/.exec(id))) return { emoji: m[1] + "\uFE0F\u20E3" };
    if (/^flag-/.test(id)) return { emoji: "\uD83D\uDEA9" };
    if (/^star-/.test(id)) return { emoji: "\u2B50" };
    if (id === "symbol-question") return { emoji: "\u2753" };
    if (id === "symbol-exclam") return { emoji: "\u2757" };
    return null;
  }

  // Keeps the links whose both ends were imported; a node linked to
  // itself and exact repeats are dropped.
  function keepLinks(raw, refs) {
    var out = [], seen = dict();
    for (var i = 0; i < raw.length && out.length < MAX_NODES; i++) {
      var l = raw[i], key = l.from + "\n" + l.to + "\n" + l.label;
      if (!l.from || !l.to || l.from === l.to || !refs[l.from] || !refs[l.to] || seen[key]) continue;
      seen[key] = true;
      out.push(l);
    }
    return out;
  }

  // ---------- 2. FreeMind / Freeplane ----------
  // <map version="…"><node TEXT ID LINK COLOR BACKGROUND_COLOR>
  //   <richcontent TYPE="NODE|NOTE|DETAILS"><html>…</html></richcontent>
  //   <icon BUILTIN/> <arrowlink DESTINATION MIDDLE_LABEL/> <node …/>
  // readXml keeps an element's own text apart from its children's,
  // so inline HTML tags (<b>, <a>, <font>…) inside richcontent would
  // scramble the word order. Before reading, inside richcontent
  // blocks only, inline tags are removed and <br> / <img> become
  // marker characters; block tags (<p>, <li>…) stay and become line
  // breaks. A node that is only a picture gets a picture emoji.
  var ATTRS = "(?:\\s+[A-Za-z_][\\w:.-]*\\s*=\\s*(?:\"[^\"]*\"|'[^']*'))*";
  var INLINE_RE = new RegExp("<\\/?(?:a|abbr|b|big|cite|code|em|font|i|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|tt|u|var)" + ATTRS + "\\s*\\/?>", "gi");
  var BR_RE = new RegExp("<br" + ATTRS + "\\s*\\/?>|<\\/br\\s*>", "gi");
  var IMG_RE = new RegExp("<img" + ATTRS + "\\s*\\/?>", "gi");
  var BR = "\u0001", BLOCK = "\u0002", IMG = "\u0003";
  var MARKS = /[\u0001-\u0003]/g;
  var BLOCKS = { p: 1, div: 1, li: 1, ul: 1, ol: 1, dl: 1, dt: 1, dd: 1, tr: 1, table: 1, blockquote: 1, pre: 1,
                 h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, body: 1, hr: 1 };
  var SKIP = { head: 1, style: 1, script: 1, title: 1 };

  // Linear scan (a lazy regex over a file full of unclosed
  // <richcontent> tags would be quadratic).
  function prepRich(text) {
    text = text.replace(MARKS, "");
    var out = [], pos = 0;
    for (;;) {
      var s = text.indexOf("<richcontent", pos);
      if (s < 0) break;
      var e = text.indexOf("</richcontent", s);
      if (e < 0) break;
      out.push(text.slice(pos, s),
        text.slice(s, e).replace(/&nbsp;/g, "&#160;").replace(INLINE_RE, "").replace(BR_RE, BR).replace(IMG_RE, IMG));
      pos = e;
    }
    out.push(text.slice(pos));
    return out.join("");
  }
  // HTML element tree → { text, img }. Recursion is bounded by readXml.
  function htmlText(el, max) {
    var out = [];
    (function walk(e) {
      var n = local(e.name).toLowerCase();
      if (own(SKIP, n)) return;
      var b = own(BLOCKS, n);
      if (b) out.push(BLOCK);
      out.push(e._text);
      e.kids.forEach(walk);
      if (b) out.push(BLOCK);
    })(el);
    var s = out.join("");
    return { img: s.indexOf(IMG) >= 0, text: C.para(s.replace(/\u0003/g, "").replace(/\s+/g, " ")
      .replace(/ ?\u0002[\u0002 ]*/g, "\n").replace(/ ?\u0001 ?/g, "\n"), max) };
  }
  function richText(el, max) {
    if (el.kids.length) return htmlText(el, max);
    return { img: el._text.indexOf(IMG) >= 0, text: C.para(el._text.replace(/\u0003/g, "").replace(MARKS, "\n"), max) };
  }

  function groupHook(el) {
    if (el.attrs.TEXT && C.line(el.attrs.TEXT, TEXT_LEN)) return "";
    var h = kidsNamed(el, "hook").filter(function (k) {
      return k.attrs.NAME === "FirstGroupNode" || k.attrs.NAME === "SummaryNode";
    })[0];
    return h ? h.attrs.NAME : "";
  }

  function parseFreeMind(text, fallbackTitle) {
    if (typeof text !== "string" || text.length > IMPORT_MAX) return fail("size");
    var doc = C.readXml(prepRich(text));
    var map = doc && first(doc, "map");
    if (!map) return fail("format");
    var top = first(map, "node");
    if (!top) return fail("empty");
    var count = 0, refs = dict(), links = [];
    function conv(el) {
      var a = el.attrs, t, note = [], i, k;
      count++;
      t = xnode(a.TEXT !== undefined ? C.para(a.TEXT, TEXT_LEN) : "");
      t.ref = ref(a.ID);
      if (t.ref && !refs[t.ref]) refs[t.ref] = true;
      t.url = webUrl(a.LINK);
      t.color = nearestColor(a.COLOR) || nearestColor(a.BACKGROUND_COLOR);
      for (i = 0; i < el.kids.length; i++) {
        k = el.kids[i];
        var n = local(k.name), ty = str(k.attrs.TYPE).toUpperCase();
        if (n === "richcontent") {
          if (ty === "NODE" && !t.text) {
            var rt = richText(k, TEXT_LEN);
            t.text = rt.text;
            if (!rt.text && rt.img) t.emoji = PICTURE;
          } else if (ty === "NOTE" || ty === "DETAILS") note.push(richText(k, NOTE_LEN).text);
        } else if (n === "hook" && /NodeNote/.test(str(k.attrs.NAME))) {
          var tx = first(k, "text");                 // FreeMind 0.7 notes
          if (tx) note.push(C.para(tx._text, NOTE_LEN));
        } else if (n === "icon") {
          var ic = str(k.attrs.BUILTIN);
          if (own(FM_DONE, ic)) t.done = true;
          else if (!t.emoji && own(FM_ICONS, ic)) t.emoji = FM_ICONS[ic];
        } else if (n === "arrowlink") {
          var lab = k.attrs.MIDDLE_LABEL || k.attrs.SOURCE_LABEL || k.attrs.TARGET_LABEL || "";
          links.push({ from: t.ref, to: ref(k.attrs.DESTINATION), label: C.line(lab, LABEL_LEN) });
        } else if (n === "node" && count < MAX_NODES) {
          // Freeplane summaries: an empty "FirstGroupNode" marks where
          // a group starts (dropped); an empty "SummaryNode" holds the
          // summary's label as its child (lifted into its place).
          var hook = groupHook(k);
          if (hook === "FirstGroupNode") continue;
          if (hook === "SummaryNode") {
            kidsNamed(k, "node").forEach(function (g) { if (count < MAX_NODES) t.kids.push(conv(g)); });
          } else t.kids.push(conv(k));
        }
      }
      if (!t.text && a.LOCALIZED_TEXT !== undefined) t.text = C.para(a.LOCALIZED_TEXT, TEXT_LEN);
      t.note = C.para(note.filter(Boolean).join("\n\n"), NOTE_LEN);
      return t;
    }
    var tree = conv(top);
    if (!C.line(tree.text, TEXT_LEN)) tree.text = C.line(fallbackTitle, 200) || "Mind map";
    tree.links = keepLinks(links, refs);
    return { ok: true, tree: tree };
  }

  // ---------- 3. ZIP (read-only) ----------
  // Adapted from atelier/zip.js (orOS Atelier): stored and deflated
  // entries, central directory only, no ZIP64, no encryption.
  // Inflating uses DecompressionStream("deflate-raw"). Limits: entry
  // count, and the inflated size is checked WHILE it streams (the
  // header's size is not trusted). Only the entry asked for is read.
  var MAX_ENTRIES = 20000;
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function utf8(bytes) {
    var s = new TextDecoder("utf-8").decode(bytes);
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }
  function openZip(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw new Error("zip");
    var eocd = -1, stop = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= stop; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip");
    var count = u16(bytes, eocd + 10), cdOff = u32(bytes, eocd + 16);
    if (count > MAX_ENTRIES || cdOff >= bytes.length) throw new Error("zip");
    var entries = dict(), p = cdOff;
    for (var n = 0; n < count; n++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("zip");
      var method = u16(bytes, p + 10), csize = u32(bytes, p + 20), size = u32(bytes, p + 24);
      var nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32);
      var flags = u16(bytes, p + 8), loc = u32(bytes, p + 42);
      if (p + 46 + nlen > bytes.length) throw new Error("zip");
      var name = utf8(bytes.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
      p += 46 + nlen + xlen + clen;
      if (name.slice(-1) === "/" || flags & 1) continue;       // folders, encrypted entries
      if (!entries[name]) entries[name] = { method: method, csize: csize, size: size, loc: loc };
    }
    function dataOf(e) {
      var l = e.loc;
      if (l + 30 > bytes.length || u32(bytes, l) !== 0x04034b50) throw new Error("zip");
      var start = l + 30 + u16(bytes, l + 26) + u16(bytes, l + 28), end = start + e.csize;
      if (end > bytes.length) throw new Error("zip");
      return bytes.subarray(start, end);
    }
    function inflate(data, max) {
      if (typeof DecompressionStream !== "function") return Promise.reject(new Error("inflate"));
      var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter();
      w.write(data).then(null, function () {});
      w.close().then(null, function () {});
      var reader = ds.readable.getReader(), parts = [], total = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(total), o = 0;
            parts.forEach(function (c) { out.set(c, o); o += c.length; });
            return out;
          }
          total += r.value.length;
          if (total > max) { try { reader.cancel().then(null, function () {}); } catch (e) {} throw new Error("toobig"); }
          parts.push(r.value);
          return pump();
        });
      }
      return pump();
    }
    function getBytes(name, max) {
      var e = entries[name];
      if (!e) return Promise.resolve(null);
      try {
        if (e.size > max) return Promise.reject(new Error("toobig"));
        var data = dataOf(e);
        if (e.method === 0) {
          if (data.length > max) return Promise.reject(new Error("toobig"));
          return Promise.resolve(data.slice());
        }
        if (e.method === 8) return inflate(data, max);
      } catch (err) { return Promise.reject(err); }
      return Promise.reject(new Error("zip"));
    }
    return {
      has: function (name) { return !!entries[name]; },
      text: function (name, max) { return getBytes(name, max).then(function (b) { return b ? utf8(b) : null; }); }
    };
  }

  // ---------- 4. XMind ----------
  function sheetsResult(tree, sheets, links, refs) {
    tree.links = keepLinks(links, refs);
    tree.sheets = sheets;
    return { ok: true, tree: tree };
  }
  function rootTitle(tree, sheetTitle, fallbackTitle) {
    if (!C.line(tree.text, TEXT_LEN)) tree.text = C.line(sheetTitle, 200) || C.line(fallbackTitle, 200) || "Mind map";
  }

  // XMind Zen / 2020+: content.json = [sheet, …], sheet = { title,
  // rootTopic, relationships: [{ end1Id, end2Id, title }] }, topic =
  // { id, title, href, notes: { plain: { content } }, markers:
  // [{ markerId }], children: { attached: [topic…] } }. Iterative.
  function topicTitle(tp) {
    if (typeof tp.title === "string") return tp.title;
    if (Array.isArray(tp.attributedTitle)) {
      return tp.attributedTitle.map(function (r) { return r && typeof r.text === "string" ? r.text : ""; }).join("");
    }
    return "";
  }
  function fromZen(text, fallbackTitle) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return fail("format"); }
    var sheets = Array.isArray(d) ? d : (d && typeof d === "object" && d.rootTopic ? [d] : null);
    if (!sheets || !sheets.length) return fail("format");
    var sh = sheets[0];
    if (!sh || typeof sh !== "object" || !sh.rootTopic || typeof sh.rootTopic !== "object") return fail("empty");
    var count = 0, refs = dict(), tree = null;
    var stack = [[sh.rootTopic, null, 0]];
    while (stack.length && count < MAX_NODES) {
      var e = stack.pop(), tp = e[0];
      if (!tp || typeof tp !== "object") continue;
      var t = xnode(C.para(topicTitle(tp), TEXT_LEN));
      count++;
      t.ref = ref(tp.id);
      if (t.ref && !refs[t.ref]) refs[t.ref] = true;
      t.url = webUrl(tp.href);
      var nt = tp.notes && tp.notes.plain && tp.notes.plain.content;
      t.note = C.para(str(nt), NOTE_LEN);
      if (Array.isArray(tp.markers)) {
        tp.markers.forEach(function (m) {
          var x = m && xmMarker(str(m.markerId));
          if (!x) return;
          if (x.done) t.done = true;
          if (x.emoji && !t.emoji) t.emoji = x.emoji;
        });
      }
      if (Array.isArray(tp.extensions)) {         // XMind 2022+ tasks
        tp.extensions.forEach(function (x) {
          if (x && x.provider === "org.xmind.ui.task" && x.content && x.content.status === "done") t.done = true;
        });
      }
      var props = tp.style && tp.style.properties;
      if (props && typeof props === "object") t.color = nearestColor(props["svg:fill"]);
      if (e[1]) e[1].kids.push(t); else tree = t;
      var att = tp.children && tp.children.attached;
      if (Array.isArray(att) && e[2] < DEPTH) {
        for (var i = Math.min(att.length, MAX_NODES) - 1; i >= 0; i--) stack.push([att[i], t, e[2] + 1]);
      }
    }
    if (!tree) return fail("empty");
    rootTitle(tree, sh.title, fallbackTitle);
    var links = [];
    if (Array.isArray(sh.relationships)) {
      sh.relationships.forEach(function (r) {
        if (r && typeof r === "object") links.push({ from: ref(r.end1Id), to: ref(r.end2Id), label: C.line(str(r.title), LABEL_LEN) });
      });
    }
    return sheetsResult(tree, sheets.length, links, refs);
  }

  // XMind 8: content.xml = <xmap-content><sheet><topic id><title>
  // <children><topics type="attached"><topic>…, xlink:href,
  // <notes><plain>, <marker-refs><marker-ref marker-id>, and
  // <relationships><relationship end1 end2><title>. Recursion is
  // bounded by readXml's nesting limit.
  function fromXml8(text, fallbackTitle) {
    if (typeof text !== "string" || text.length > IMPORT_MAX) return fail("size");
    var doc = C.readXml(text);
    var xmap = doc && first(doc, "xmap-content");
    if (!xmap) return fail("format");
    var sheets = kidsNamed(xmap, "sheet");
    if (!sheets.length) return fail("empty");
    var sh = sheets[0], top = first(sh, "topic");
    if (!top) return fail("empty");
    var count = 0, refs = dict();
    function conv(el) {
      count++;
      var ti = first(el, "title");
      var t = xnode(C.para(ti ? ti._text : "", TEXT_LEN));
      t.ref = ref(el.attrs.id);
      if (t.ref && !refs[t.ref]) refs[t.ref] = true;
      t.url = webUrl(el.attrs["xlink:href"]);
      var pl = first(first(el, "notes"), "plain");
      if (pl) t.note = C.para(pl._text, NOTE_LEN);
      kidsNamed(first(el, "marker-refs"), "marker-ref").forEach(function (m) {
        var x = xmMarker(str(m.attrs["marker-id"]));
        if (!x) return;
        if (x.done) t.done = true;
        if (x.emoji && !t.emoji) t.emoji = x.emoji;
      });
      kidsNamed(first(el, "children"), "topics").forEach(function (ts) {
        if (str(ts.attrs.type) !== "attached") return;
        kidsNamed(ts, "topic").forEach(function (k) { if (count < MAX_NODES) t.kids.push(conv(k)); });
      });
      return t;
    }
    var tree = conv(top), st = first(sh, "title");
    rootTitle(tree, st ? st._text : "", fallbackTitle);
    var links = kidsNamed(first(sh, "relationships"), "relationship").map(function (r) {
      var lt = first(r, "title");
      return { from: ref(r.attrs.end1), to: ref(r.attrs.end2), label: C.line(lt ? lt._text : "", LABEL_LEN) };
    });
    return sheetsResult(tree, sheets.length, links, refs);
  }

  function asBytes(b) {
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return new Uint8Array(b);
    return null;
  }

  // bytes: the whole .xmind file. A bare content.xml (some tools
  // write one) is read as XMind 8.
  function parseXMind(bytes, fallbackTitle) {
    return Promise.resolve().then(function () {
      var b = asBytes(bytes);
      if (!b) return fail("format");
      if (b.length > FILE_MAX) return fail("size");
      var kind = sniff(b);
      if (kind === "xml") return b.length > IMPORT_MAX ? fail("size") : fromXml8(utf8(b), fallbackTitle);
      if (kind !== "zip") return fail("zip");
      var z;
      try { z = openZip(b); } catch (e) { return fail("zip"); }
      // Zen files also hold a content.xml that only says "open me
      // with a newer XMind": content.json wins.
      var name = z.has("content.json") ? "content.json" : (z.has("content.xml") ? "content.xml" : "");
      if (!name) return fail("format");
      return z.text(name, IMPORT_MAX).then(function (t) {
        return name === "content.json" ? fromZen(t, fallbackTitle) : fromXml8(t, fallbackTitle);
      }, function (e) {
        return fail(e && e.message === "toobig" ? "size" : "zip");
      });
    });
  }

  // ---------- 5. sniff ----------
  function sniff(bytes) {
    var b = asBytes(bytes);
    if (!b || !b.length) return "";
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
    var i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
    while (i < b.length && i < 1024 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
    return b[i] === 0x3c ? "xml" : "";
  }

  var api = {
    parseFreeMind: parseFreeMind, parseXMind: parseXMind, sniff: sniff,
    nearestColor: nearestColor, webUrl: webUrl
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMImport = api;
})(this);
