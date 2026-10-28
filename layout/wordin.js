// ============================================================
// orOS Layout — Place a document's text (v1.0.0)
// A Word, OpenDocument, RTF, HTML, Markdown or plain-text file is
// read by Writer's own reader (writer/io.js, WriterIO: the same
// headings, bold, italic, lists and quotations as Writer's Open) and
// its HTML becomes Layout paragraphs here. Each paragraph gets a role
// (LY-WD):
//   h1 h2 h3  headings (h4-h6 count as h3)
//   p1        the first paragraph after a heading, an empty line or
//             at the start (a book sets it without an indent)
//   p         other paragraphs
//   center    a centred paragraph (a scene break, a poem's line)
//   quote     a quotation
//   li        a list item
// and the document's mapping (setup.ext.wmap: role → paragraph style
// id, kept with the document) gives its style. Empty paragraphs stay
// empty paragraphs. Pictures, tables' layout and footnotes are not
// placed (a table's cells become paragraphs).
// Pure: parse(html) and paras(list, map) run under Node; the reading
// of files is in layout/io.js.
// Exposes LY_WORDIN (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var ROLES = ["h1", "h2", "h3", "p1", "p", "center", "quote", "li"];
  // the seed styles a new document has (designkit/model.js SEED_PS)
  var SEED = { h1: "ps-h1", h2: "ps-h2", h3: "ps-h3", p1: "ps-body", p: "ps-body", center: "ps-body", quote: "ps-quote", li: "ps-list" };
  var MAX_PARAS = 20000;
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      var v = ENT[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }
  function attr(a, name) {
    var m = new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i").exec(a || "");
    return m ? (m[2] !== undefined ? m[2] : m[3]) : "";
  }

  // Writer's HTML → [{ role, runs: [{ t, b, i, u }] }]
  function parse(html) {
    var out = [], cur = null, blocks = [], fmt = { b: 0, i: 0, u: 0 }, inl = [], sups = [], skip = 0;
    var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g, m;
    function roleOf() {
      for (var k = blocks.length - 1; k >= 0; k--) {
        var b = blocks[k];
        if (/^h[1-6]$/.test(b.tag)) return "h" + Math.min(3, +b.tag[1]);
        if (b.tag === "li") return "li";
        if (b.tag === "blockquote") return "quote";
      }
      var c = blocks.length && blocks[blocks.length - 1].center;
      return c ? "center" : "p";
    }
    function open() {
      if (blocks.length) blocks[blocks.length - 1].had = 1;
      if (!cur) cur = { role: roleOf(), runs: [] };
    }
    function flush() {
      if (!cur) return;
      // spaces made of tabs and no-break spaces: one space; none at the ends
      var runs = [];
      cur.runs.forEach(function (r) {
        var t = r.t.replace(/[ \t\u00A0]+/g, " ");
        var last = runs[runs.length - 1];
        if (last && last.b === r.b && last.i === r.i && last.u === r.u) last.t += t;
        else runs.push({ t: t, b: r.b, i: r.i, u: r.u });
      });
      if (runs.length) {
        runs[0].t = runs[0].t.replace(/^[ \n]+/, "");
        runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/[ \n]+$/, "");
      }
      runs = runs.filter(function (r) { return r.t; }).map(function (r) {
        var o = { t: r.t };
        if (r.b) o.b = 1;
        if (r.i) o.i = 1;
        if (r.u) o.u = 1;
        return o;
      });
      if (out.length < MAX_PARAS) out.push({ role: cur.role, runs: runs });
      cur = null;
    }
    html = String(html || "").replace(/<!--[\s\S]*?(-->|$)|<![^>]*>|<\?[^>]*>/g, "");
    while ((m = re.exec(html))) {
      if (m[4] !== undefined) {
        if (skip) continue;
        var t = decode(m[4]).replace(/[\r\n]+/g, " ");
        if (!cur && !t.trim()) continue;
        open();
        cur.runs.push({ t: t, b: fmt.b, i: fmt.i, u: fmt.u });
        continue;
      }
      var close = m[1] === "/", tag = m[2].toLowerCase(), a = m[3];
      if (/^(h[1-6]|p|div|li|blockquote|td|th|tr|ul|ol|table)$/.test(tag)) {
        flush();
        // an empty paragraph (<p></p>) stays an empty paragraph
        if (close && tag === "p" && blocks.length && blocks[blocks.length - 1].tag === "p" && !blocks[blocks.length - 1].had) { open(); flush(); }
        if (close) {
          for (var k = blocks.length - 1; k >= 0; k--) if (blocks[k].tag === tag) { blocks.length = k; break; }
        } else if (!/\/\s*$/.test(a)) blocks.push({ tag: tag, center: /text-align\s*:\s*center/i.test(attr(a, "style")) });
        continue;
      }
      if (tag === "br") { open(); cur.runs.push({ t: "\n", b: fmt.b, i: fmt.i, u: fmt.u }); continue; }
      // a footnote's mark, a comment's or picture's own content: left out
      if (tag === "sup") {
        var fn = close ? sups.pop() : /fn-ref/.test(attr(a, "class"));
        if (!close) sups.push(fn);
        if (fn) skip = Math.max(0, skip + (close ? -1 : 1));
        continue;
      }
      if (tag === "script" || tag === "style" || tag === "title") { skip = Math.max(0, skip + (close ? -1 : 1)); continue; }
      var f = tag === "strong" || tag === "b" ? "b" : tag === "em" || tag === "i" ? "i" : tag === "u" ? "u" : "";
      if (!f) continue;
      if (!close) { inl.push(f); fmt[f]++; }
      else {
        var at = inl.lastIndexOf(f);
        if (at !== -1) { inl.splice(at, 1); fmt[f]--; }
      }
    }
    flush();
    // the first paragraph after a heading, an empty line or the start
    var after = true;
    out.forEach(function (p) {
      if (p.role === "p" && p.runs.length && after) p.role = "p1";
      after = /^h/.test(p.role) || !p.runs.length;
    });
    return out;
  }

  // the document's mapping: setup.ext.wmap where it names a style
  // that is there, else the seed style, else the base
  function mapOf(doc) {
    var have = {}, saved = (doc.setup && doc.setup.ext && doc.setup.ext.wmap) || {}, out = {};
    (doc.pstyles || []).forEach(function (s) { have[s.id] = 1; });
    ROLES.forEach(function (r) { out[r] = have[saved[r]] ? saved[r] : have[SEED[r]] ? SEED[r] : "ps-base"; });
    return out;
  }
  // parsed paragraphs + mapping → Layout paragraphs
  function paras(list, map) {
    return list.map(function (p) { return { ps: map[p.role] || "ps-base", runs: p.runs }; });
  }
  // how many paragraphs of each role (for the mapping dialog)
  function counts(list) {
    var n = {};
    list.forEach(function (p) { if (p.runs.length) n[p.role] = (n[p.role] || 0) + 1; });
    return n;
  }

  var api = { ROLES: ROLES, parse: parse, mapOf: mapOf, paras: paras, counts: counts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_WORDIN = api;
})(typeof window !== "undefined" ? window : this);
