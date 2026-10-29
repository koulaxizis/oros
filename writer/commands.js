// ============================================================
// orOS Writer — commands.js: what the Assistant may change in a
// document (AS-EDIT, wave WR1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Writer, in the
// step format of the automations (recipes/core.js specs; field names
// as in the other catalogs where they mean the same). The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the documents it
//     is for (targets), count what it would change on copies (preview)
//     and describe a document to the AI (outline, with the user's
//     consent);
//   - in Writer (assist.js), which applies it and saves the result as
//     a new edit of each document, so it syncs like any other change.
// A document's text is the html Writer stores (the browser's own
// serialization, sanitized). It is read here by a small tag-aware
// parser (no DOM, so the tests run it as it is): only what a command
// changes is written anew, everything else comes back byte for byte.
// Paragraph commands pick the document's paragraphs (blocks: a
// paragraph, heading, list item, quote, code block or table) with:
//   paras  "" (all) | odd | even | first | last | "2-4,6" (1 = first)
//   what   "" (every block) | para | heading | h1 | h2 | h3 | h4 |
//          item | quote | code | table
//   has    words in the paragraph's text
// Deleted text of tracked changes and footnote numbers are not text.
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more.
// Pure: no DOM. Exposes window.WriterCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  if (!R) return;

  var WHAT = ["", "para", "heading", "h1", "h2", "h3", "h4", "item", "quote", "code", "table"];
  var TAGS = ["p", "h1", "h2", "h3", "h4", "quote", "code", "bullet", "number"];
  var PAPERS = ["a4", "a3", "a5", "b5", "letter", "legal", "full-width"];
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  function mm() { return { t: "num", lo: 0, hi: 100, def: null }; }
  var ONOFF = oneOf(["", "on", "off"]);
  var SEL = { paras: { t: "str", max: 60 }, what: oneOf(WHAT), has: { t: "str", max: 200 } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }

  // kind: "doc" (every command edits the document)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 2000 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 20000, req: 1 } }) },
    textstyle: { kind: "doc", args: sel({ bold: ONOFF, ital: ONOFF, under: ONOFF, strike: ONOFF, align: oneOf(["", "l", "c", "r", "j"]),
      find: { t: "str", max: 500 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    style: { kind: "doc", args: sel({ tag: oneOf([""].concat(TAGS)), brk: ONOFF }) },
    add: { kind: "doc", args: { text: { t: "str", max: 20000, req: 1 }, tag: { t: "enum", v: TAGS, def: "p" }, at: oneOf(["end", "start", "before", "after"]),
      para: { t: "int", lo: 0, hi: 99999, def: 0 } } },
    remove: { kind: "doc", args: sel({}) },
    page: { kind: "doc", args: { paper: oneOf([""].concat(PAPERS)), t: mm(), b: mm(), l: mm(), r: mm(), header: { t: "str", max: 200 }, footer: { t: "str", max: 200 } } },
    meta: { kind: "doc", args: { author: { t: "str", max: 120 }, tags: { t: "str", max: 400 }, category: { t: "str", max: 80 }, lang: oneOf(["", "auto", "en", "el", "none"]) } },
    rename: { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Writer commands (documents are texts; paragraphs (blocks: paragraphs, headings, list items, quotes, code blocks, tables) are picked with paras (\"\" all, odd, even, first, last or positions like 2-4,6; 1 = the first, as numbered by read_in_app), " +
    "what (\"\" every block, or para, heading, h1, h2, h3, h4, item (list item), quote, code, table) and has (words in the paragraph); null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in the text of the picked paragraphs (cs = match case, word = whole words; repl \"\" removes); with nothing picked also in the header, footer and footnotes",
    "settext: the whole text of the picked paragraphs becomes `text` (more lines make more paragraphs of the same kind; pick them with paras, what or has)",
    "textstyle: bold, ital, under, strike (on|off) for the picked paragraphs, or with find (cs, word) only for those words (on only); align l|c|r|j (left, centre, right, justified) of the picked paragraphs",
    "style: tag p|h1|h2|h3|h4|quote|code|bullet|number (paragraph, headings 1-4, quote, code, bulleted or numbered list) for the picked paragraphs; brk on|off: a page break before each of them",
    "add: new paragraphs from `text` (one per line) with tag (default p; bullet or number make a list), at end|start|before|after paragraph `para` (1 = first)",
    "remove: delete the picked paragraphs (needs paras, what or has)",
    "page: paper " + PAPERS.join("|") + ", margins t, b, l, r (top, bottom, left, right in mm, 0-100), header, footer (printed on every page; a single space clears one)",
    "meta: author, tags (comma separated; replaces the list), category, lang (spelling language: auto|en|el|none)",
    "rename: the document's title becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var PARAS_RX = /^\s*(|all|odd|even|first|last|\d{1,5}(\s*-\s*\d{1,5})?(\s*,\s*\d{1,5}(\s*-\s*\d{1,5})?)*)\s*$/i;
  // The 0-based positions `spec` names among `count` paragraphs.
  function paraSet(spec, count) {
    var s = String(spec || "").trim().toLowerCase(), out = {};
    if (!PARAS_RX.test(s)) return {};
    for (var i = 0; i < count; i++) {
      if (!s || s === "all" || (s === "odd" && i % 2 === 0) || (s === "even" && i % 2 === 1) || (s === "first" && i === 0) || (s === "last" && i === count - 1)) out[i] = 1;
    }
    if (/^\d/.test(s)) {
      s.split(",").forEach(function (part) {
        var m = part.trim().split(/\s*-\s*/), a = +m[0], b = m.length > 1 ? +m[1] : a;
        for (var p = Math.max(1, a); p <= Math.min(count, b); p++) out[p - 1] = 1;
      });
    }
    return out;
  }
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function picks(st) { return given(st.paras) || given(st.what) || given(st.has); }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.paras === "string" && !PARAS_RX.test(raw.paras)) bad.push("paras " + JSON.stringify(raw.paras) + " is not a paragraph list");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if ((st.op === "remove" || st.op === "settext") && !picks(st)) return { err: st.op + ": pick the paragraphs with paras, what or has" };
    if (st.op === "textstyle") {
      if (!st.bold && !st.ital && !st.under && !st.strike && !st.align) return { err: "textstyle: give bold, ital, under, strike or align" };
      if (given(st.find) && [st.bold, st.ital, st.under, st.strike].indexOf("off") >= 0) return { err: "textstyle: with find only on works (off works on whole paragraphs)" };
    }
    if (st.op === "style" && !st.tag && !st.brk) return { err: "style: give tag or brk" };
    if ((st.op === "add") && (st.at === "before" || st.at === "after") && !st.para) return { err: "add: before or after needs para" };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, i) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (i + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. The html, as a small tree ----------
  // Element { tag, attrs (as written, with its leading space), kids,
  // v: void }, text { raw (as written) }, comment { cm }. Only nodes a
  // command touches are written anew.
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var TOKEN_RX = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
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
  function ser(n) {
    if (n.raw !== undefined) return n.raw;
    if (n.cm !== undefined) return n.cm;
    var s = n.kids.map(ser).join("");
    if (!n.tag) return s;
    return "<" + n.tag + n.attrs + ">" + (n.v ? "" : s + "</" + n.tag + ">");
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
  function encode(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;"); }
  function textNode(s) { return { raw: encode(s) }; }
  function elem(tag, kids, attrs) { return { tag: tag, attrs: attrs || "", kids: kids || [] }; }

  // attributes
  var ATTR_RX = /([^\s"'>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  function attrList(el) {
    var out = [], m;
    ATTR_RX.lastIndex = 0;
    while ((m = ATTR_RX.exec(el.attrs || ""))) {
      var v = m[2] === undefined ? null : m[2].replace(/^["']|["']$/g, "");
      out.push({ k: m[1].toLowerCase(), v: v === null ? null : decode(v) });
    }
    return out;
  }
  function attr(el, k) { var a = attrList(el).filter(function (x) { return x.k === k; })[0]; return a ? a.v : null; }
  function setAttr(el, k, v) {
    var list = attrList(el), found = false;
    list = list.filter(function (x) {
      if (x.k !== k) return true;
      if (found || v === null) return false;
      found = true; x.v = v;
      return true;
    });
    if (!found && v !== null) list.push({ k: k, v: v });
    el.attrs = list.map(function (x) { return " " + x.k + (x.v === null ? "" : "=\"" + x.v.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + "\""); }).join("");
  }
  function hasClass(el, c) { return (" " + (attr(el, "class") || "") + " ").replace(/\s+/g, " ").indexOf(" " + c + " ") >= 0; }
  function styleOf(el) {
    var o = {}, keys = [];
    String(attr(el, "style") || "").split(";").forEach(function (d) {
      var i = d.indexOf(":");
      if (i < 1) return;
      var k = d.slice(0, i).trim().toLowerCase();
      if (!(k in o)) keys.push(k);
      o[k] = d.slice(i + 1).trim();
    });
    return { o: o, keys: keys };
  }
  // Sets (or with null removes) one style property → changed?
  function setStyle(el, prop, val) {
    var s = styleOf(el), had = prop in s.o;
    if (val === null ? !had : s.o[prop] === val) return false;
    if (val === null) { delete s.o[prop]; s.keys = s.keys.filter(function (k) { return k !== prop; }); }
    else { if (!had) s.keys.push(prop); s.o[prop] = val; }
    setAttr(el, "style", s.keys.length ? s.keys.map(function (k) { return k + ": " + s.o[k] + ";"; }).join(" ") : null);
    return true;
  }

  // ---------- 3. Paragraphs ----------
  var BLOCK = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, div: 1, blockquote: 1, pre: 1, table: 1, hr: 1, figure: 1, section: 1, article: 1,
    header: 1, footer: 1, aside: 1, nav: 1, dl: 1, address: 1, details: 1, ul: 1, ol: 1 };
  var INNER_BLOCK = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, div: 1, blockquote: 1, pre: 1, table: 1, ul: 1, ol: 1, li: 1, hr: 1, figure: 1, section: 1, dl: 1 };
  function isBreak(n) { return n.tag === "div" && hasClass(n, "page-break-marker"); }
  function blank(n) { return n.raw !== undefined && !/[^\s]/.test(decode(n.raw).replace(/ /g, "x")); }
  function kindOf(tag) {
    if (/^h[1-6]$/.test(tag)) return "heading";
    return tag === "li" ? "item" : tag === "blockquote" ? "quote" : tag === "pre" ? "code" : tag === "table" ? "table" : "para";
  }
  // The document's paragraphs, in order: [{ el, list?, kind }] or, for
  // loose text and inline elements at the top, [{ run: [nodes], kind: "para" }].
  function blocks(doc) {
    var out = [], run = null;
    doc.kids.forEach(function (n) {
      if (n.tag === "ul" || n.tag === "ol") {
        run = null;
        n.kids.forEach(function (li) { if (li.tag === "li") out.push({ el: li, list: n, kind: "item" }); });
        return;
      }
      if (n.tag && BLOCK[n.tag]) {
        run = null;
        if (!isBreak(n) && n.tag !== "hr") out.push({ el: n, kind: kindOf(n.tag) });
        return;
      }
      if (n.cm !== undefined || (!run && blank(n))) return;
      if (!run) { run = { run: [], kind: "para" }; out.push(run); }
      run.run.push(n);
    });
    out.forEach(function (b) { if (b.run) while (b.run.length > 1 && blank(b.run[b.run.length - 1])) b.run.pop(); });
    return out;
  }
  // A loose run becomes a <p> (for commands that need one element).
  function elOf(doc, b) {
    if (b.el) return b.el;
    var i = doc.kids.indexOf(b.run[0]), p = elem("p", b.run.slice());
    doc.kids.splice(i, b.run.length, p);
    b.el = p; b.run = null;
    return p;
  }
  function kidsOf(b) { return b.el ? b.el.kids : b.run; }
  // Text nodes of some nodes, with the look around each: [{ n, parent, f: { b, i, u, s }, g }]
  // (g: a group number; a line break or an inner block starts a new one,
  // so a search never runs across them). Skips footnote numbers and
  // tracked deletions.
  function textNodes(kids) {
    var out = [], g = 0;
    function walk(list, f) {
      list.forEach(function (n) {
        if (n.raw !== undefined) { out.push({ n: n, parent: list, f: f, g: g }); return; }
        if (n.cm !== undefined) return;
        if (n.tag === "br" || INNER_BLOCK[n.tag]) g++;
        if (n.v || n.tag === "br") return;
        if (n.tag === "sup" && hasClass(n, "fn-ref")) return;
        if (n.tag === "del" && hasClass(n, "tc")) return;
        var st = styleOf(n).o, f2 = { b: f.b, i: f.i, u: f.u, s: f.s };
        if (n.tag === "b" || n.tag === "strong" || /^h[1-6]$/.test(n.tag) || n.tag === "th" || /^(bold|bolder|[6-9]00)$/.test(st["font-weight"] || "")) f2.b = 1;
        if (n.tag === "i" || n.tag === "em" || /^(italic|oblique)/.test(st["font-style"] || "")) f2.i = 1;
        if (n.tag === "u" || /underline/.test(st["text-decoration"] || st["text-decoration-line"] || "")) f2.u = 1;
        if (n.tag === "s" || n.tag === "strike" || n.tag === "del" || /line-through/.test(st["text-decoration"] || st["text-decoration-line"] || "")) f2.s = 1;
        walk(n.kids, f2);
        if (INNER_BLOCK[n.tag]) g++;
      });
    }
    walk(kids, {});
    return out;
  }
  function textOfKids(kids) {
    var s = "", g = -1;
    textNodes(kids).forEach(function (t) { if (g >= 0 && t.g !== g) s += "\n"; g = t.g; s += decode(t.n.raw); });
    return s;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function kindOk(b, what) {
    if (!what) return true;
    if (/^h\d$/.test(what)) return b.el && b.el.tag === what;
    return b.kind === what;
  }
  // The paragraphs a command picks → [block], in document order.
  function pick(doc, st) {
    var all = blocks(doc), set = paraSet(st.paras, all.length), has = norm(st.has);
    return all.filter(function (b, i) {
      return set[i] && kindOk(b, st.what) && (!has || norm(textOfKids(kidsOf(b))).indexOf(has) >= 0);
    });
  }

  // ---------- 4. Applying ----------
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find).replace(/ /g, "[ \\u00a0]");
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  // The matches of rx in a group of text nodes: [{ a, b, s }] (offsets
  // in the joined text).
  function matches(group, rx) {
    var full = group.map(function (t) { return decode(t.n.raw); }).join(""), out = [], m;
    rx.lastIndex = 0;
    while ((m = rx.exec(full))) {
      if (!m[0].length) { rx.lastIndex++; continue; }
      out.push({ a: m.index, b: m.index + m[0].length, s: m[0] });
    }
    return out;
  }
  function groups(kids) {
    var out = [], g = null;
    textNodes(kids).forEach(function (t) {
      if (!g || g.id !== t.g) { g = { id: t.g, list: [] }; out.push(g); }
      g.list.push(t);
    });
    return out.map(function (x) { return x.list; });
  }
  // find → repl in some nodes; a match across formatting goes into the
  // first node's look. → how many replaced
  function replaceIn(kids, rx, repl) {
    var k = 0;
    groups(kids).forEach(function (group) {
      var ms = matches(group, rx);
      if (!ms.length) return;
      var texts = group.map(function (t) { return decode(t.n.raw); }), starts = [], pos = 0;
      texts.forEach(function (s) { starts.push(pos); pos += s.length; });
      for (var j = ms.length - 1; j >= 0; j--) {
        var mt = ms[j], first = -1, lastN = -1;
        for (var i = 0; i < texts.length; i++) {
          var a = starts[i], b = a + texts[i].length;
          if (mt.a < b && mt.b > a) { if (first < 0) first = i; lastN = i; }
          else if (mt.a === a && mt.a === mt.b) first = lastN = i;
        }
        if (first < 0) continue;
        if (first === lastN) {
          var off = mt.a - starts[first];
          texts[first] = texts[first].slice(0, off) + repl + texts[first].slice(off + (mt.b - mt.a));
        } else {
          texts[first] = texts[first].slice(0, mt.a - starts[first]) + repl;
          for (var x = first + 1; x < lastN; x++) texts[x] = "";
          texts[lastN] = texts[lastN].slice(mt.b - starts[lastN]);
        }
        k++;
      }
      group.forEach(function (t, i) { if (decode(t.n.raw) !== texts[i]) t.n.raw = encode(texts[i]); });
    });
    return k;
  }
  var LOOK = { bold: { f: "b", tag: "b", off: ["b", "strong"], css: "font-weight" }, ital: { f: "i", tag: "i", off: ["i", "em"], css: "font-style" },
    under: { f: "u", tag: "u", off: ["u"], css: "text-decoration" }, strike: { f: "s", tag: "s", off: ["s", "strike", "del"], css: "text-decoration" } };
  function wrapLooks(kidsOfText, wants) {
    var out = kidsOfText;
    wants.forEach(function (w) { out = [elem(LOOK[w].tag, out)]; });
    return out;
  }
  // Puts parts [[a, b]…] (in order) of a text node into the looks it
  // lacks → changed?
  function wrapRanges(t, cuts, wants) {
    var s = decode(t.n.raw), need = wants.filter(function (w) { return !t.f[LOOK[w].f]; });
    if (!need.length) return false;
    var parts = [], at = 0;
    cuts.forEach(function (c) {
      if (c[1] <= c[0] || c[0] < at) return;
      if (c[0] > at) parts.push(textNode(s.slice(at, c[0])));
      parts = parts.concat(wrapLooks([textNode(s.slice(c[0], c[1]))], need));
      at = c[1];
    });
    if (!parts.length) return false;
    if (at < s.length) parts.push(textNode(s.slice(at)));
    var i = t.parent.indexOf(t.n);
    t.parent.splice.apply(t.parent, [i, 1].concat(parts));
    return true;
  }
  // on: every text without the look gets it; off: the look's tags are
  // taken away (their text stays) and its style is cleared → changed?
  function lookBlock(b, w, v) {
    var L = LOOK[w], ch = false;
    if (v === "on") {
      textNodes(kidsOf(b)).forEach(function (t) {
        var s = decode(t.n.raw);
        if (s && wrapRanges(t, [[0, s.length]], [w])) ch = true;
      });
      return ch;
    }
    function strip(list) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n.tag || n.v) continue;
        if (n.tag === "sup" && hasClass(n, "fn-ref")) continue;
        strip(n.kids);
        if (L.off.indexOf(n.tag) >= 0 && !(n.tag === "del" && hasClass(n, "tc"))) {
          list.splice.apply(list, [i, 1].concat(n.kids));
          i += n.kids.length - 1;
          ch = true;
          continue;
        }
        var st = styleOf(n).o[L.css];
        if (st && (w === "bold" ? /^(bold|bolder|[6-9]00)$/.test(st) : w === "ital" ? /^(italic|oblique)/.test(st) : w === "under" ? /underline/.test(st) : /line-through/.test(st))) {
          if (setStyle(n, L.css, null)) ch = true;
        }
      }
    }
    if (b.el) {
      var own = styleOf(b.el).o[L.css];
      if (own && (w === "bold" ? /^(bold|bolder|[6-9]00)$/.test(own) : w === "ital" ? /^(italic|oblique)/.test(own) : w === "under" ? /underline/.test(own) : /line-through/.test(own))) {
        if (setStyle(b.el, L.css, null)) ch = true;
      }
    }
    strip(kidsOf(b));
    return ch;
  }
  var ALIGN = { l: null, c: "center", r: "right", j: "justify" };
  var BREAK_HTML = "<div class=\"page-break-marker\" contenteditable=\"false\"></div>";
  function breakNode() { return parse(BREAK_HTML).kids[0]; }
  function hasBlockKids(el) { return el.kids.some(function (n) { return n.tag && INNER_BLOCK[n.tag]; }); }
  function tagEl(tag) { return tag === "quote" ? "blockquote" : tag === "code" ? "pre" : tag; }
  // The top-level node a paragraph sits in (its list for a list item).
  function topOf(b) { return b.list || b.el || b.run[0]; }
  function prevReal(list, i) { for (var j = i - 1; j >= 0; j--) if (!blank(list[j])) return j; return -1; }
  function nextReal(list, i) { for (var j = i + 1; j < list.length; j++) if (!blank(list[j])) return j; return -1; }

  // style tag: retags paragraphs, makes lists and takes items out of them.
  function retag(doc, picked, tag) {
    var k = 0, i, listTag = tag === "bullet" ? "ul" : tag === "number" ? "ol" : "";
    // list items
    var lists = [];
    picked.forEach(function (b) { if (b.list && lists.indexOf(b.list) < 0) lists.push(b.list); });
    lists.forEach(function (list) {
      var mine = picked.filter(function (b) { return b.list === list; }).map(function (b) { return b.el; });
      if (listTag) {
        if (list.tag !== listTag) { list.tag = listTag; k += mine.length; }
        return;
      }
      var seq = [], cur = null;
      list.kids.forEach(function (n) {
        if (n.tag === "li" && mine.indexOf(n) >= 0 && !hasBlockKids(n)) {
          var el = elem(tagEl(tag), n.kids);
          var al = styleOf(n).o["text-align"];
          if (al) setStyle(el, "text-align", al);
          seq.push(el); cur = null; k++;
          return;
        }
        if (!cur) { cur = elem(list.tag, [], list.attrs); seq.push(cur); }
        cur.kids.push(n);
      });
      seq = seq.filter(function (n) { return !(n.tag === list.tag && !n.kids.some(function (x) { return x.tag === "li"; })); });
      var at = doc.kids.indexOf(list);
      doc.kids.splice.apply(doc.kids, [at, 1].concat(seq));
    });
    // other paragraphs
    var rest = picked.filter(function (b) { return !b.list && b.kind !== "table"; }), lastList = null, newLists = [];
    rest.forEach(function (b) {
      var el = elOf(doc, b);
      if (hasBlockKids(el)) return;
      if (!listTag) {
        var nt = tagEl(tag);
        if (el.tag !== nt) { el.tag = nt; k++; }
        return;
      }
      i = doc.kids.indexOf(el);
      var li = elem("li", el.kids), al = styleOf(el).o["text-align"];
      if (al) setStyle(li, "text-align", al);
      var pj = prevReal(doc.kids, i), before = pj >= 0 ? doc.kids[pj] : null;
      if (before && before === lastList) {
        before.kids.push(li);
        doc.kids.splice(pj + 1, i - pj);
      } else {
        lastList = elem(listTag, [li]);
        newLists.push(lastList);
        doc.kids.splice(i, 1, lastList);
      }
      k++;
    });
    // a new list right before a list of the same kind joins it
    for (i = 0; i < doc.kids.length; i++) {
      var n = doc.kids[i];
      if (!listTag || n.tag !== listTag) continue;
      var nj = nextReal(doc.kids, i), nx = nj >= 0 ? doc.kids[nj] : null;
      if (nx && nx.tag === listTag && newLists.indexOf(n) >= 0) {
        n.kids = n.kids.concat(nx.kids);
        doc.kids.splice(i + 1, nj - i);
        i--;
      }
    }
    return k;
  }
  // A page break before each picked paragraph (on), or none (off).
  function breaks(doc, picked, v) {
    var k = 0, done = [];
    picked.forEach(function (b) {
      var top = topOf(b);
      if (b.list && b.list.kids.filter(function (x) { return x.tag === "li"; })[0] !== b.el) return;   // only before a list's first item
      if (done.indexOf(top) >= 0) return;
      done.push(top);
      var i = doc.kids.indexOf(top), pj = prevReal(doc.kids, i), prev = pj >= 0 ? doc.kids[pj] : null;
      var has = !!(prev && isBreak(prev));
      if (v === "on" && !has && pj >= 0) { doc.kids.splice(i, 0, breakNode()); k++; }
      if (v === "off" && has) { doc.kids.splice(pj, 1); k++; }
    });
    return k;
  }
  // New nodes from text lines: one paragraph (or list item) per line.
  function linesOf(text) { return String(text).replace(/\r\n?/g, "\n").split("\n").filter(function (l) { return l.trim(); }); }
  function nodesFor(text, tag) {
    var lines = linesOf(text);
    if (!lines.length) return [];
    if (tag === "bullet" || tag === "number") {
      return [elem(tag === "bullet" ? "ul" : "ol", lines.map(function (l) { return elem("li", [textNode(l)]); }))];
    }
    return lines.map(function (l) { return elem(tagEl(tag), [textNode(l)]); });
  }
  function addParas(doc, st) {
    var made = nodesFor(st.text, st.tag), n = linesOf(st.text).length;
    if (!made.length) return 0;
    var all = blocks(doc);
    if (st.at === "start") { doc.kids.splice.apply(doc.kids, [0, 0].concat(made)); return n; }
    if (st.at === "end" || !all.length) { doc.kids.push.apply(doc.kids, made); return n; }
    var b = all[Math.min(all.length, st.para) - 1], after = st.at === "after";
    if (b.list && (st.tag === "bullet" || st.tag === "number")) {
      var li = made[0].kids, j = b.list.kids.indexOf(b.el) + (after ? 1 : 0);
      b.list.kids.splice.apply(b.list.kids, [j, 0].concat(li));
      return n;
    }
    var top = topOf(b), i = doc.kids.indexOf(top);
    if (after && b.run) i = doc.kids.indexOf(b.run[b.run.length - 1]);
    doc.kids.splice.apply(doc.kids, [i + (after ? 1 : 0), 0].concat(made));
    return n;
  }
  function removeBlocks(doc, picked) {
    var k = 0;
    picked.forEach(function (b) {
      if (b.list) {
        b.list.kids.splice(b.list.kids.indexOf(b.el), 1);
        if (!b.list.kids.some(function (x) { return x.tag === "li"; })) doc.kids.splice(doc.kids.indexOf(b.list), 1);
      } else if (b.run) b.run.forEach(function (n) { doc.kids.splice(doc.kids.indexOf(n), 1); });
      else doc.kids.splice(doc.kids.indexOf(b.el), 1);
      k++;
    });
    return k;
  }
  function setText(doc, picked, text) {
    var k = 0, lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    picked.forEach(function (b) {
      var el = elOf(doc, b);
      if (b.kind === "table") return;
      var before = ser(el);
      var br = elem("br", []);
      br.v = 1;
      el.kids = [lines[0] ? textNode(lines[0]) : br];
      var more = lines.slice(1).filter(function (l) { return l.trim(); }).map(function (l) { return elem(el.tag, [textNode(l)], el.attrs); });
      var host = b.list ? b.list.kids : doc.kids;
      host.splice.apply(host, [host.indexOf(el) + 1, 0].concat(more));
      if (ser(el) !== before || more.length) k++;
    });
    return k;
  }
  // Footnotes whose number left the text go too (as Writer's own clean-up).
  function fnIds(html) {
    var o = {}, m, rx = /<sup\b[^>]*\bdata-fn="([^"]+)"/g;
    while ((m = rx.exec(html))) o[m[1]] = 1;
    return o;
  }
  function trimNotes(w) {
    if (!Array.isArray(w.footnotes) || !w.footnotes.length) return;
    var ids = fnIds(w.html);
    w.footnotes = w.footnotes.filter(function (f) { return f && ids[f.id]; });
  }
  function cleanLine(s, max) { return String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }

  // A document as the commands see it (a copy of Writer's record).
  function work(rec) {
    var m = rec && rec.margins && typeof rec.margins === "object" ? rec.margins : {};
    function n(v) { return Number.isFinite(+v) ? +v : 25; }
    return {
      id: rec.id, title: String(rec.title || ""), author: String(rec.author || ""), tags: Array.isArray(rec.tags) ? rec.tags.slice() : [],
      category: String(rec.category || ""), lang: typeof rec.lang === "string" ? rec.lang : "", html: String(rec.html || ""),
      header: String(rec.header || ""), footer: String(rec.footer || ""),
      footnotes: Array.isArray(rec.footnotes) ? JSON.parse(JSON.stringify(rec.footnotes)) : [],
      pageSize: typeof rec.pageSize === "string" ? rec.pageSize : "a4", margins: { top: n(m.top), bottom: n(m.bottom), left: n(m.left), right: n(m.right) }
    };
  }

  // One command on a document copy (work()) → how many things changed.
  function apply(w, st, env) {
    env = env || {};
    var k = 0;
    switch (st.op) {
      case "rename":
        var t = cleanLine(st.title, 120);
        if (!t || t === w.title) return 0;
        w.title = t;
        return 1;
      case "meta":
        if (given(st.author) && cleanLine(st.author, 120) !== w.author) { w.author = cleanLine(st.author, 120); k++; }
        if (given(st.tags)) {
          var tags = [];
          st.tags.split(",").forEach(function (x) { x = cleanLine(x, 40); if (x && tags.indexOf(x) < 0 && tags.length < 30) tags.push(x); });
          if (JSON.stringify(tags) !== JSON.stringify(w.tags)) { w.tags = tags; k++; }
        }
        if (given(st.category) && cleanLine(st.category, 80) !== w.category) { w.category = cleanLine(st.category, 80); k++; }
        if (st.lang) {
          var lg = st.lang === "auto" ? "" : st.lang;
          if (lg !== w.lang) { w.lang = lg; k++; }
        }
        return k;
      case "page":
        if (st.paper && st.paper !== w.pageSize) { w.pageSize = st.paper; k++; }
        [["t", "top"], ["b", "bottom"], ["l", "left"], ["r", "right"]].forEach(function (p) {
          if (st[p[0]] === null || st[p[0]] === undefined) return;
          var v = Math.round(st[p[0]]);
          if (w.margins[p[1]] !== v) { w.margins[p[1]] = v; k++; }
        });
        ["header", "footer"].forEach(function (f) {
          if (!given(st[f])) return;
          var v = cleanLine(st[f], 200);
          if (v !== w[f]) { w[f] = v; k++; }
        });
        return k;
    }
    var doc = parse(w.html), before = w.html;
    if (st.op === "add") k = addParas(doc, st);
    else {
      var picked = pick(doc, st);
      if (!picked.length) { note(env, "noParas"); }
      else if (st.op === "replace") {
        var rx = finder(st);
        picked.forEach(function (b) { k += replaceIn(kidsOf(b), rx, st.repl || ""); });
      } else if (st.op === "settext") k = setText(doc, picked, st.text);
      else if (st.op === "remove") k = removeBlocks(doc, picked);
      else if (st.op === "style") {
        // breaks first: they sit before the paragraphs as they are now
        if (st.brk) k += breaks(doc, picked, st.brk);
        if (st.tag) k += retag(doc, picked, st.tag);
      } else if (st.op === "textstyle") {
        var wants = ["bold", "ital", "under", "strike"].filter(function (x) { return st[x]; });
        picked.forEach(function (b) {
          var ch = false;
          if (given(st.find) && wants.length) {
            var rx2 = finder(st);
            groups(kidsOf(b)).forEach(function (group) {
              var ms = matches(group, rx2), pos = 0;
              group.forEach(function (t) {
                var len = decode(t.n.raw).length, a0 = pos;
                pos += len;
                var cuts = ms.filter(function (m) { return m.a < a0 + len && m.b > a0; }).map(function (m) { return [Math.max(m.a, a0) - a0, Math.min(m.b, a0 + len) - a0]; });
                if (cuts.length && wrapRanges(t, cuts, wants)) ch = true;
              });
            });
          } else {
            wants.forEach(function (x) { if (lookBlock(b, x, st[x])) ch = true; });
          }
          if (st.align) {
            var el = elOf(doc, b);
            if (setStyle(el, "text-align", ALIGN[st.align])) ch = true;
          }
          if (ch) k++;
        });
      }
    }
    if (k) {
      w.html = ser(doc);
      if (w.html === before) k = 0;
      if (st.op === "remove" || st.op === "settext") trimNotes(w);
    }
    // the header, footer and footnotes, when no paragraph was picked
    if (st.op === "replace" && !picks(st)) {
      var rx3 = finder(st);
      ["header", "footer"].forEach(function (f) {
        rx3.lastIndex = 0;
        var v = w[f].replace(rx3, st.repl || "");
        if (v !== w[f]) { w[f] = v; k++; }
      });
      w.footnotes.forEach(function (fn) {
        if (!fn || typeof fn.text !== "string") return;
        rx3.lastIndex = 0;
        var v = fn.text.replace(rx3, st.repl || "");
        if (v !== fn.text) { fn.text = v; k++; }
      });
    }
    return k;
  }
  // ---------- 5. For the Assistant ----------
  function snippet(html) { return textOfKids(parse(html).kids).replace(/\s+/g, " ").trim().slice(0, 32); }
  function nameOf(rec) { return String(rec.title || "").trim() || snippet(rec.html); }
  // The stored slice as a list of documents: { docs: [{ id, name, m }], data }
  // (each doc's `store`, for outline and preview, is Writer's record).
  function view(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.docs)) return { docs: [], data: null };
    return { docs: data.docs.filter(function (d) { return d && typeof d.id === "string" && !d.del; }).map(function (d) {
      var o = { id: d.id, name: nameOf(d), m: Number(d.mtime) || 0 };
      Object.defineProperty(o, "store", { value: d });   // not copied
      return o;
    }), data: data };
  }
  // Which documents a request is for. data: view(), open: the open
  // document's id. designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new document comes from a document card (propose_entry kind document); use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Writer has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no documents in Writer yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the document's title" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no document is called " + JSON.stringify(String(name).slice(0, 80)) + "; documents: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several documents match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole title" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no document is open in Writer; name the document (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] }, recs = {};
    ((data && data.docs) || []).forEach(function (d) { recs[d.id] = d.store; });
    ids.forEach(function (id) {
      if (!recs[id]) return;
      var w = work(recs[id]), k = 0, env = { notes: out.notes };
      steps.forEach(function (st) { k += apply(w, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: nameOf(w), n: k }); }
    });
    return out;
  }
  // A document for the model: its details, page and every paragraph
  // with its number, kind, alignment and text (up to a limit).
  var OUT_PARAS = 400, OUT_TEXT = 500;
  function short(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }
  function outline(doc) {
    var rec = doc && doc.store;
    if (!rec) return null;
    var w = work(rec), tree = parse(w.html), all = blocks(tree), words = 0;
    var o = { title: w.title, author: w.author, tags: w.tags, category: w.category, lang: w.lang || "auto",
      paper: w.pageSize, margins: { t: w.margins.top, b: w.margins.bottom, l: w.margins.left, r: w.margins.right }, header: w.header, footer: w.footer, paragraphs: [] };
    all.forEach(function (b, i) {
      var tx = textOfKids(kidsOf(b));
      words += (tx.match(/[\p{L}\p{N}]+/gu) || []).length;
      if (i >= OUT_PARAS) return;
      var e = { n: i + 1, kind: b.el && /^h\d$/.test(b.el.tag) ? b.el.tag : b.kind };
      if (b.list) e.list = b.list.tag === "ol" ? "number" : "bullet";
      var al = b.el ? styleOf(b.el).o["text-align"] : "";
      if (al && al !== "left" && al !== "start") e.align = al === "center" ? "c" : al === "right" ? "r" : al === "justify" ? "j" : al;
      var top = topOf(b), ti = tree.kids.indexOf(top), pj = prevReal(tree.kids, ti);
      if ((!b.list || b.list.kids.filter(function (x) { return x.tag === "li"; })[0] === b.el) && pj >= 0 && isBreak(tree.kids[pj])) e.brk = true;
      e.text = short(tx, OUT_TEXT);
      o.paragraphs.push(e);
    });
    o.words = words;
    if (w.footnotes.length) o.footnotes = w.footnotes.slice(0, 50).map(function (f, i) { return { n: i + 1, text: short(f && f.text, 200) }; });
    if (all.length > OUT_PARAS) o.note = "Only the first " + OUT_PARAS + " of " + all.length + " paragraphs are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, WHAT: WHAT, TAGS: TAGS, PAPERS: PAPERS,
    check: check, parse: parse, ser: ser, blocks: blocks, pick: pick, paraSet: paraSet, work: work, apply: apply,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.WriterCommands = api;
})(typeof window !== "undefined" ? window : this);
