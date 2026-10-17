// i18n-inline-ok: Greek wiki syntax aliases (parser data, no UI text)
// ============================================================
// orOS Wiki — pure core (v1.2.0)
// Shared by the app (wiki.js), the search provider and the tests.
// No DOM access except render*(), which takes a document and builds
// nodes with createElement / createTextNode only (never innerHTML),
// so text from an article can never become markup or script.
//   1. Constants + helpers
//   2. Titles + ids
//   3. Data model: normalize + merge (slice "wiki")
//   4. Markup parser (Markdown subset + wiki links)
//   5. Sections (edit one section)
//   6. Plain text, links, categories, queries over the data
//   7. Diff (lines, then words inside changed lines)
//   8. Renderer (document → nodes)
//   9. Revisions (orOS disk files)
//  10. Editing helpers (tables, infobox, references, citations)
// Wave 2 (v1.1.0): pictures [[File:<asset id>|right|250px|Caption]]
// (files of designkit/assets.js on the orOS disk), {{gallery}},
// {{infobox}}, references [^name] + "[^name]: text", {{references}}.
// Exposes window.WikiCore (browser) / module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION = "1.2.0";
  var DATA_KEY = "oros-wiki-data";
  var PREFS_KEY = "oros-wiki-prefs";
  var DRAFT_KEY = "oros-wiki-draft";
  var MAX_WIKIS = 50;
  var MAX_ARTS = 5000;
  var MAX_TEXT = 200000;
  var MAX_TITLE = 200;
  var MAX_ANC = 50;          // ancestry kept per article (descendant test)
  var MAX_ALT = 5;           // parallel edits kept until resolved
  var MAX_SUM = 200;         // edit summary
  var HIST_DIR = "/internal/Wiki/History";

  var WIKI_RE = /^w[0-9a-z]{6,24}$/;
  var ART_RE = /^a[0-9a-z]{6,24}$/;
  var REV_RE = /^r[0-9a-z]{6,24}$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function int(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function canon(v) { return JSON.stringify(v); }
  // Symmetric pick (R5): newer m wins, equal m → larger canonical JSON.
  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function uid(prefix) {
    var s = Date.now().toString(36);
    var r = "";
    try {
      var b = new Uint8Array(8);
      root.crypto.getRandomValues(b);
      for (var i = 0; i < b.length; i++) r += (b[i] % 36).toString(36);
    } catch (e) {
      for (var j = 0; j < 8; j++) r += Math.floor(Math.random() * 36).toString(36);
    }
    return prefix + (s + r).slice(-18);
  }

  // ---------- 2. Titles + ids ----------
  // A title: one line, no characters that the link syntax uses.
  function cleanTitle(t) {
    return str(t).replace(/[\[\]{}|#<>\u0000-\u001f\u007f]/g, " ")
      .replace(/_/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  }
  // Lookup key: case, accents and spacing never matter.
  function fold(s) {
    return str(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/ς/g, "σ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }
  // Anchor for a heading (the part after # in a link).
  function slug(s) {
    var f = fold(s).replace(/[^\p{L}\p{N}\- ]/gu, "").replace(/\s+/g, " ").trim().replace(/ /g, "_");
    return f.slice(0, 80) || "s";
  }
  var CAT_PREFIX = /^\s*(category|κατηγορία|κατηγορια)\s*:\s*/i;
  // Pictures: an asset id of designkit/assets.js (sha256 of the file).
  var IMG_RE = /^[0-9a-f]{64}\.(jpg|png)$/;
  var FILE_PREFIX = /^\s*(file|image|αρχείο|αρχειο|εικόνα|εικονα)\s*:\s*/i;
  var ALIGN = { left: "left", right: "right", center: "center", centre: "center", none: "none",
                "αριστερά": "left", "αριστερα": "left", "δεξιά": "right", "δεξια": "right",
                "κέντρο": "center", "κεντρο": "center", "κανένα": "none", "κανενα": "none" };
  var MAX_GAL = 60;          // pictures in one gallery
  var MAX_IBOX = 60;         // rows in one infobox
  var MAX_REFS = 500;        // references in one article

  // ---------- 3. Data model ----------
  // WIKI v1 { ver:1, wikis:[wiki], arts:[art], tombs:{id: ms} }
  //   wiki { id, m, n (name), main (article id or "") }
  //   art  { id, m, w, t, x, r, anc:[rev], alt:[{r, m, t, x}], s?, c? }
  //        r = this text's revision id; anc = earlier revision ids,
  //        newest first (a copy whose anc holds the other copy's r
  //        is its descendant, so no parallel edit happened);
  //        alt = texts of parallel edits on other devices, kept until
  //        the person resolves them (no text is ever lost in a merge);
  //        s = the last edit summary; c = created (ms).
  function empty() { return { ver: 1, wikis: [], arts: [], tombs: {} }; }

  function normWiki(w) {
    if (!isObj(w) || typeof w.id !== "string" || !WIKI_RE.test(w.id)) return null;
    return {
      id: w.id,
      m: int(w.m),
      n: str(w.n).replace(/\s+/g, " ").trim().slice(0, 80),
      main: typeof w.main === "string" && ART_RE.test(w.main) ? w.main : ""
    };
  }
  function normAlt(list, r) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (!isObj(v) || typeof v.r !== "string" || !REV_RE.test(v.r) || v.r === r || seen[v.r]) return;
      seen[v.r] = 1;
      out.push({ r: v.r, m: int(v.m), t: cleanTitle(v.t), x: str(v.x).slice(0, MAX_TEXT) });
    });
    // keep the newest MAX_ALT, stored in a canonical order (by r)
    out.sort(function (a, b) { return b.m - a.m || (a.r < b.r ? -1 : 1); });
    out = out.slice(0, MAX_ALT);
    out.sort(function (a, b) { return a.r < b.r ? -1 : 1; });
    return out;
  }
  function normAnc(list, r) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (typeof v !== "string" || !REV_RE.test(v) || v === r || seen[v]) return;
      seen[v] = 1; out.push(v);
    });
    return out.slice(0, MAX_ANC);
  }
  function normArt(a) {
    if (!isObj(a) || typeof a.id !== "string" || !ART_RE.test(a.id)) return null;
    if (typeof a.w !== "string" || !WIKI_RE.test(a.w)) return null;
    var t = cleanTitle(a.t);
    if (!t) return null;
    var r = typeof a.r === "string" && REV_RE.test(a.r) ? a.r : "r" + a.id.slice(1);
    var out = { id: a.id, m: int(a.m), w: a.w, t: t, x: str(a.x).replace(/\r\n?/g, "\n").slice(0, MAX_TEXT), r: r };
    out.anc = normAnc(a.anc, r);
    var anc = {};
    out.anc.forEach(function (v) { anc[v] = 1; });
    out.alt = normAlt(a.alt, r).filter(function (v) { return !anc[v.r]; });
    var s = str(a.s).replace(/\s+/g, " ").trim().slice(0, MAX_SUM);
    if (s) out.s = s;
    if (int(a.c)) out.c = int(a.c);
    return out;
  }
  function normTombs(t) {
    var out = {};
    if (!isObj(t)) return out;
    Object.keys(t).sort().forEach(function (k) {
      if ((WIKI_RE.test(k) || ART_RE.test(k)) && int(t[k])) out[k] = int(t[k]);
    });
    return out;
  }

  // Two copies of one article → one (deterministic, no text lost).
  function mergeArt(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.r === b.r) {
      var w0 = newer(a, b), o0 = w0 === a ? b : a;
      return normArt(Object.assign({}, w0, { alt: w0.alt.concat(o0.alt), anc: w0.anc.concat(o0.anc) }));
    }
    var win, lose, conflict = false;
    if (a.anc.indexOf(b.r) >= 0) { win = a; lose = b; }
    else if (b.anc.indexOf(a.r) >= 0) { win = b; lose = a; }
    else { win = newer(a, b); lose = win === a ? b : a; conflict = true; }
    var alt = win.alt.concat(lose.alt);
    if (conflict) alt.push({ r: lose.r, m: lose.m, t: lose.t, x: lose.x });
    return normArt(Object.assign({}, win, { alt: alt }));
  }

  function normData(d) {
    if (!isObj(d)) return empty();
    var tombs = normTombs(d.tombs);
    var wikis = {}, arts = {};
    (Array.isArray(d.wikis) ? d.wikis : []).forEach(function (w) {
      w = normWiki(w);
      if (!w) return;
      wikis[w.id] = wikis[w.id] ? newer(wikis[w.id], w) : w;
    });
    (Array.isArray(d.arts) ? d.arts : []).forEach(function (a) {
      a = normArt(a);
      if (!a) return;
      arts[a.id] = mergeArt(arts[a.id], a);
    });
    return finish(wikis, arts, tombs);
  }

  function finish(wikis, arts, tombs) {
    Object.keys(wikis).forEach(function (id) {
      if (tombs[id] && tombs[id] >= wikis[id].m) delete wikis[id];
    });
    Object.keys(arts).forEach(function (id) {
      var a = arts[id];
      if (tombs[id] && tombs[id] >= a.m) { delete arts[id]; return; }
      if (wikis[a.w]) return;
      // its wiki is gone: deleted with it, unless it was edited after
      // the wiki's deletion (then the wiki comes back, nameless)
      if (tombs[a.w] && tombs[a.w] >= a.m) { delete arts[id]; return; }
      var m = Math.max(a.m, (tombs[a.w] || 0) + 1);
      if (!wikis[a.w] || wikis[a.w].m < m) wikis[a.w] = { id: a.w, m: m, n: "", main: "" };
    });
    var wl = Object.keys(wikis).sort().map(function (k) { return wikis[k]; });
    var al = Object.keys(arts).sort().map(function (k) { return arts[k]; });
    if (wl.length > MAX_WIKIS) wl = wl.slice(0, MAX_WIKIS);
    if (al.length > MAX_ARTS) al = al.slice(0, MAX_ARTS);
    return { ver: 1, wikis: wl, arts: al, tombs: tombs };
  }

  // Slice merge: symmetric; merge(x, null) is the canonical copy (R26).
  function merge(a, b) {
    var A = normData(a), B = b ? normData(b) : null;
    if (!B) return A;
    var tombs = Object.assign({}, A.tombs);
    Object.keys(B.tombs).forEach(function (k) { tombs[k] = Math.max(tombs[k] || 0, B.tombs[k]); });
    var wikis = {}, arts = {};
    A.wikis.concat(B.wikis).forEach(function (w) { wikis[w.id] = wikis[w.id] ? newer(wikis[w.id], w) : w; });
    A.arts.concat(B.arts).forEach(function (x) { arts[x.id] = mergeArt(arts[x.id], x); });
    return finish(wikis, arts, normTombs(tombs));
  }

  function parse(raw) {
    if (!raw) return empty();
    try { return normData(JSON.parse(raw)); } catch (e) { return empty(); }
  }

  function normPrefs(p) {
    p = isObj(p) ? p : {};
    return {
      w: typeof p.w === "string" && WIKI_RE.test(p.w) ? p.w : "",
      a: typeof p.a === "string" && ART_RE.test(p.a) ? p.a : "",
      side: p.side === 0 ? 0 : 1
    };
  }

  // ---------- 4. Markup parser ----------
  // Blocks: headings (## or == ==), paragraphs, - / 1. lists (nested by
  // two spaces), > quotes, ``` code, --- rule, | tables |.
  // Inline: **bold**, *italic* / _italic_, ~~struck~~, `code`,
  // [[Title]], [[Title#Section|text]], [[Category:Name]] (files the
  // article, shows nothing), [[:Category:Name]] (a link to it),
  // [text](https://…), bare https:// links, \ escapes the next sign.
  // First line "#REDIRECT [[Title]]" makes the article a redirect.
  // [[File:id|…]] is a picture, [^name] a reference (wave 2).
  var MAX_DEPTH = 4;
  var RE_REF = /^\[\^([\p{L}\p{N}_.\-]{1,40})\]/u;
  var RE_REFDEF = /^\s*\[\^([\p{L}\p{N}_.\-]{1,40})\]:\s*(.*)$/u;

  // "[[File:…]]" starting at i → index after its closing "]]" (links
  // inside the caption may nest), or -1.
  function fileEnd(s, i) {
    if (s.substr(i, 2) !== "[[" || !FILE_PREFIX.test(s.slice(i + 2, i + 40))) return -1;
    var d = 0;
    for (var j = i; j < s.length - 1; j++) {
      if (s.charAt(j) === "[" && s.charAt(j + 1) === "[") { d++; j++; }
      else if (s.charAt(j) === "]" && s.charAt(j + 1) === "]") { d--; j++; if (!d) return j + 1; }
    }
    return -1;
  }
  // Split on | outside [[ ]] and `code` (\| stays).
  function splitTop(s) {
    var parts = [], cur = "", link = 0, code = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\" && s.charAt(i + 1) === "|") { cur += "\\|"; i++; continue; }
      if (!code && c === "[" && s.charAt(i + 1) === "[") { link++; cur += "[["; i++; continue; }
      if (!code && link && c === "]" && s.charAt(i + 1) === "]") { link--; cur += "]]"; i++; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !link && !code) { parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }
  // "id|right|250px|alt=…|Caption" (no File: prefix, no brackets)
  function fileParts(body) {
    var parts = splitTop(str(body).replace(FILE_PREFIX, ""));
    var id = parts[0].trim().toLowerCase(), al = "", w = 0, alt = "", cap = "";
    parts.slice(1).forEach(function (p) {
      var q = p.trim(), lq = q.toLowerCase(), m;
      if (!q) return;
      if (ALIGN[lq]) al = ALIGN[lq];
      else if ((m = /^(\d{1,6})\s*px$/.exec(lq))) w = Math.max(40, Math.min(1200, Number(m[1])));
      else if (/^(thumb|thumbnail|frame|frameless|border|upright|μικρογραφία|μικρογραφια)$/.test(lq)) return;
      else if ((m = /^alt\s*=\s*([\s\S]*)$/i.exec(q))) alt = m[1].trim().slice(0, 300);
      else cap = q;
    });
    return { id: IMG_RE.test(id) ? id : "", raw: id.slice(0, 80), al: al, w: w, alt: alt, cap: cap.slice(0, 1000) };
  }
  // A reference use: numbered by first use, counted for back links.
  function refNode(acc, name) {
    var key = fold(name);
    if (!acc.refN) { acc.refN = {}; acc.refOrder = []; acc.refUse = {}; }
    if (!acc.refN[key]) {
      if (acc.refOrder.length >= MAX_REFS) return { k: "t", v: "[^" + name + "]" };
      acc.refOrder.push({ key: key, name: name });
      acc.refN[key] = acc.refOrder.length;
    }
    acc.refUse[key] = (acc.refUse[key] || 0) + 1;
    return { k: "ref", key: key, n: acc.refN[key], i: acc.refUse[key] };
  }

  function safeUrl(u) {
    u = str(u).trim();
    if (/^https?:\/\/[^\s"'<>\\]+$/i.test(u) && /^https?:\/\/[^\/?#\s]+\.[^\/?#\s]/i.test(u)) return u;
    if (/^mailto:[^\s"'<>\\@]+@[^\s"'<>\\@]+$/i.test(u)) return u;
    return "";
  }

  function wikiTarget(raw) {
    // "Title#Section" → { to, frag }; ":Category:X" → category page
    var s = str(raw).trim(), cat = false, page = false;
    if (s.charAt(0) === ":") { s = s.slice(1); page = true; }
    if (CAT_PREFIX.test(s)) { cat = true; s = s.replace(CAT_PREFIX, ""); }
    var frag = "", h = s.indexOf("#");
    if (h >= 0) { frag = s.slice(h + 1).trim(); s = s.slice(0, h); }
    return { to: cleanTitle(s), frag: frag.slice(0, 120), cat: cat, catLink: cat && page };
  }

  function parseInline(s, depth, out) {
    out = out || { links: [], cats: [] };
    depth = depth || 0;
    var nodes = [], buf = "", i = 0, n = s.length;
    function flush() { if (buf) { nodes.push({ k: "t", v: buf }); buf = ""; } }
    function pair(open, close, kind) {
      if (s.substr(i, open.length) !== open) return false;
      var j = s.indexOf(close, i + open.length);
      if (j <= i + open.length) return false;
      var inner = s.slice(i + open.length, j);
      if (/^\s|\s$/.test(inner)) return false;
      flush();
      nodes.push({ k: kind, c: depth < MAX_DEPTH ? parseInline(inner, depth + 1, out).nodes : [{ k: "t", v: inner }] });
      i = j + close.length;
      return true;
    }
    while (i < n) {
      var c = s.charAt(i);
      if (c === "\\" && i + 1 < n && /[\\`*_~\[\]()#|>!=^{}-]/.test(s.charAt(i + 1))) { buf += s.charAt(i + 1); i += 2; continue; }
      if (c === "`") {
        var e = s.indexOf("`", i + 1);
        if (e > i + 1) { flush(); nodes.push({ k: "code", v: s.slice(i + 1, e) }); i = e + 1; continue; }
      }
      if (c === "[" && s.charAt(i + 1) === "^" && !out.noRef) {
        var rf = RE_REF.exec(s.slice(i, i + 46));
        if (rf) { flush(); nodes.push(refNode(out, rf[1])); i += rf[0].length; continue; }
      }
      if (c === "[" && s.charAt(i + 1) === "[") {
        var fe = fileEnd(s, i);
        if (fe > 0) {
          var fp = fileParts(s.slice(i + 2, fe - 2));
          flush();
          nodes.push({ k: "img", id: fp.id, raw: fp.raw, w: fp.w, alt: fp.alt || fp.cap });
          i = fe;
          continue;
        }
        var e2 = s.indexOf("]]", i + 2);
        if (e2 > i + 2) {
          var body = s.slice(i + 2, e2), bar = body.indexOf("|");
          var tg = wikiTarget(bar >= 0 ? body.slice(0, bar) : body);
          var label = bar >= 0 ? body.slice(bar + 1).trim() : "";
          if (!tg.to && tg.frag && !tg.cat) {
            flush();
            nodes.push({ k: "wl", to: "", frag: tg.frag, v: label || tg.frag });
            i = e2 + 2;
            continue;
          }
          if (tg.to) {
            flush();
            if (tg.cat && !tg.catLink) {
              out.cats.push(tg.to);
            } else if (tg.cat) {
              nodes.push({ k: "cl", to: tg.to, v: label || tg.to });
            } else {
              out.links.push(tg.to);
              nodes.push({ k: "wl", to: tg.to, frag: tg.frag, v: label || tg.to });
            }
            i = e2 + 2;
            continue;
          }
        }
      }
      if (c === "[") {
        var m = /^\[([^\]\n]{1,300})\]\(([^()\s]{1,2000})\)/.exec(s.slice(i, i + 2400));
        if (m) {
          var url = safeUrl(m[2]);
          flush();
          if (url) nodes.push({ k: "xl", href: url, v: m[1] });
          else nodes.push({ k: "t", v: m[1] });
          i += m[0].length;
          continue;
        }
      }
      if (c === "h" && (i === 0 || /[\s(]/.test(s.charAt(i - 1)))) {
        var mu = /^https?:\/\/[^\s<>"'\])]+/i.exec(s.slice(i, i + 2100));
        if (mu) {
          var raw = mu[0].replace(/[.,;:!?]+$/, ""), u2 = safeUrl(raw);
          if (u2) { flush(); nodes.push({ k: "xl", href: u2, v: raw }); i += raw.length; continue; }
        }
      }
      if (c === "*" && s.charAt(i + 1) === "*" && pair("**", "**", "b")) continue;
      if (c === "~" && s.charAt(i + 1) === "~" && pair("~~", "~~", "s")) continue;
      if (c === "*" && s.charAt(i + 1) !== "*" && pair("*", "*", "i")) continue;
      if (c === "_" && (i === 0 || !/[\p{L}\p{N}]/u.test(s.charAt(i - 1)))) {
        var e3 = s.indexOf("_", i + 1);
        if (e3 > i + 1 && (e3 + 1 >= n || !/[\p{L}\p{N}]/u.test(s.charAt(e3 + 1))) && pair("_", "_", "i")) continue;
      }
      buf += c;
      i++;
    }
    flush();
    return { nodes: nodes, links: out.links, cats: out.cats };
  }

  var RE_HEAD_MD = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  var RE_HEAD_WIKI = /^(={2,6})\s*(.+?)\s*\1\s*$/;
  var RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  var RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  var RE_FENCE = /^\s*```/;
  var RE_TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  var RE_REDIRECT = /^\s*#\s*(redirect|ανακατευθυνση|ανακατεύθυνση)\s*:?\s*\[\[([^\]]+)\]\]/i;
  // {{infobox … }}, {{gallery … }} on their own lines; {{references}}
  var RE_TPL = /^\s*\{\{\s*([\p{L}]+)\s*(\}\})?\s*$/u;
  var RE_TPL_END = /^\s*\}\}\s*$/;
  var TPL_KIND = { infobox: "ibox", "πλαισιο": "ibox", gallery: "gal", "γκαλερι": "gal", "συλλογη": "gal",
                   references: "refs", reflist: "refs", "παραπομπεσ": "refs" };
  var IBOX_KEY = { title: "title", name: "title", "τιτλοσ": "title", "ονομα": "title",
                   image: "image", "εικονα": "image", caption: "caption", "λεζαντα": "caption" };
  function tplKind(m) { return m ? TPL_KIND[fold(m[1])] || "" : ""; }

  function headLevel(line) {
    var m = RE_HEAD_WIKI.exec(line);
    if (m) return { lvl: Math.min(4, m[1].length), text: m[2] };
    m = RE_HEAD_MD.exec(line);
    if (m && !/^#\s*(redirect|ανακατ)/i.test(line)) return { lvl: Math.min(4, Math.max(2, m[1].length)), text: m[2] };
    return null;
  }

  // "| a | [[b|c]] | `d|e` |" → ["a", "[[b|c]]", "`d|e`"]
  function splitCells(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|" && s.charAt(s.length - 2) !== "\\") s = s.slice(0, -1);
    var cells = [], cur = "", inLink = 0, inCode = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\" && s.charAt(i + 1) === "|") { cur += "\\|"; i++; continue; }
      if (!inCode && c === "[" && s.charAt(i + 1) === "[") { inLink++; cur += "[["; i++; continue; }
      if (!inCode && inLink && c === "]" && s.charAt(i + 1) === "]") { inLink--; cur += "]]"; i++; continue; }
      if (c === "`") inCode = !inCode;
      if (c === "|" && !inLink && !inCode) { cells.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }
  function aligns(line) {
    return splitCells(line).map(function (c) {
      var l = c.charAt(0) === ":", r = c.charAt(c.length - 1) === ":";
      return l && r ? "center" : (r ? "right" : (l ? "left" : ""));
    });
  }

  // Parse a whole article. Returns { redirect, blocks, heads, links, cats }.
  //   heads: [{ lvl, text, anchor, line, n }] — n = section number (1…)
  function parseDoc(text, depth, acc) {
    depth = depth || 0;
    var top = !acc;
    acc = acc || { links: [], cats: [], heads: [], anchors: {} };
    var lines = str(text).replace(/\r\n?/g, "\n").split("\n");
    var blocks = [], redirect = "", i = 0;
    if (top) {
      for (var f = 0; f < lines.length; f++) {
        if (!lines[f].trim()) continue;
        var rm = RE_REDIRECT.exec(lines[f]);
        if (rm) { redirect = wikiTarget(rm[2].split("|")[0]).to; i = f + 1; }
        break;
      }
    }
    var para = [];
    function inl(s) { return parseInline(s, 0, acc).nodes; }
    function endPara() {
      if (!para.length) return;
      var nodes = inl(para.join(" ").replace(/\s+/g, " ").trim());
      para = [];
      if (nodes.length) blocks.push({ k: "p", c: nodes });
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { endPara(); i++; continue; }
      if (RE_FENCE.test(line)) {
        endPara();
        var code = [];
        i++;
        while (i < lines.length && !RE_FENCE.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        blocks.push({ k: "pre", v: code.join("\n") });
        continue;
      }
      var dm = RE_REFDEF.exec(line);
      if (dm) {
        endPara();
        var dt = dm[2];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !RE_REFDEF.test(lines[i])) { dt += " " + lines[i].trim(); i++; }
        var dk = fold(dm[1]);
        acc.refDefs = acc.refDefs || {};
        if (!acc.refDefs[dk]) acc.refDefs[dk] = { name: dm[1], c: parseInline(dt.trim(), 0, { links: acc.links, cats: acc.cats, noRef: true }).nodes };
        continue;
      }
      var tm = RE_TPL.exec(line), kind = tplKind(tm);
      if (kind === "refs") { endPara(); blocks.push({ k: "refs" }); i++; continue; }
      if (kind && !tm[2]) {
        endPara();
        var tb = [];
        i++;
        while (i < lines.length && !RE_TPL_END.test(lines[i])) { tb.push(lines[i]); i++; }
        i++;
        blocks.push(kind === "gal" ? galBlock(tb, inl) : iboxBlock(tb, inl));
        continue;
      }
      if (/^\s*\[\[/.test(line)) {
        var lt = line.trim();
        if (fileEnd(lt, 0) === lt.length) {
          endPara();
          var fq = fileParts(lt.slice(2, -2));
          blocks.push({ k: "fig", id: fq.id, raw: fq.raw, al: fq.al || "right", w: fq.w, alt: fq.alt, c: inl(fq.cap) });
          i++;
          continue;
        }
      }
      var h = headLevel(line);
      if (h) {
        endPara();
        var hc = inl(h.text), base = slug(inlineText(hc)), anchor = base, k = 2;
        while (acc.anchors[anchor]) anchor = base + "_" + (k++);
        acc.anchors[anchor] = 1;
        var head = { k: "h", lvl: h.lvl, c: hc, anchor: anchor };
        if (top) {
          head.n = acc.heads.length + 1;
          acc.heads.push({ lvl: h.lvl, text: inlineText(hc), anchor: anchor, line: i, n: head.n });
        }
        blocks.push(head);
        i++;
        continue;
      }
      if (RE_HR.test(line)) { endPara(); blocks.push({ k: "hr" }); i++; continue; }
      if (/^\s*>/.test(line)) {
        endPara();
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        var inner = depth < 2 ? parseDoc(q.join("\n"), depth + 1, acc).blocks : [{ k: "p", c: [{ k: "t", v: q.join(" ") }] }];
        blocks.push({ k: "quote", c: inner });
        continue;
      }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && RE_TSEP.test(lines[i + 1]) && lines[i + 1].indexOf("-") >= 0) {
        endPara();
        var al = aligns(lines[i + 1]);
        var head2 = splitCells(line).map(inl);
        var rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i]) && rows.length < 500) {
          rows.push(splitCells(lines[i]).map(inl));
          i++;
        }
        blocks.push({ k: "table", head: head2, rows: rows, al: al });
        continue;
      }
      var lm = RE_LIST.exec(line);
      if (lm && !(para.length && /^\d/.test(lm[2]) && lm[1] === "" && lm[2] !== "1." && lm[2] !== "1)")) {
        endPara();
        var items = [];
        while (i < lines.length) {
          var l2 = lines[i], m2 = RE_LIST.exec(l2);
          if (m2) {
            items.push({ lvl: Math.min(3, Math.floor(m2[1].replace(/\t/g, "  ").length / 2)), ord: /^\d/.test(m2[2]), text: m2[3] });
            i++;
          } else if (items.length && /^\s{2,}\S/.test(l2) && !headLevel(l2.trim())) {
            items[items.length - 1].text += " " + l2.trim();
            i++;
          } else break;
        }
        for (var pos = 0; pos < items.length;) {
          var built = buildList(items, pos, inl);
          blocks.push(built.list);
          pos = built.next;
        }
        continue;
      }
      para.push(line.trim());
      i++;
    }
    endPara();
    var res = { redirect: redirect, blocks: blocks };
    if (top) {
      res.heads = acc.heads;
      res.links = uniqTitles(acc.links);
      res.cats = uniqTitles(acc.cats);
      res.refs = buildRefs(acc);
    }
    return res;
  }

  // {{gallery}} lines: "File:id|Caption" (brackets optional)
  function galBlock(lines, inl) {
    var items = [];
    lines.forEach(function (l) {
      var s = l.trim();
      if (!s || items.length >= MAX_GAL) return;
      if (/^\[\[/.test(s) && /\]\]$/.test(s)) s = s.slice(2, -2);
      var fp = fileParts(s);
      items.push({ id: fp.id, raw: fp.raw, alt: fp.alt, c: inl(fp.cap) });
    });
    return { k: "gal", items: items };
  }
  // {{infobox}} lines: "| key = value"; a line without | continues the value.
  function iboxRaw(lines) {
    var rows = [], cur = null;
    lines.forEach(function (l) {
      var m = /^\s*\|\s*([^=|]{1,80}?)\s*=\s*(.*)$/.exec(l);
      if (m) { cur = { k: m[1].trim(), v: m[2].trim() }; rows.push(cur); }
      else if (cur && l.trim()) cur.v = (cur.v + " " + l.trim()).trim();
    });
    var o = { title: "", image: "", caption: "", rows: [] };
    rows.forEach(function (r) {
      var key = IBOX_KEY[fold(r.k)];
      if (key && !o[key]) o[key] = r.v;
      else if (!key && o.rows.length < MAX_IBOX) o.rows.push([r.k, r.v]);
    });
    return o;
  }
  function iboxBlock(lines, inl) {
    var o = iboxRaw(lines), img = null;
    if (o.image) {
      var s = o.image.trim();
      if (/^\[\[/.test(s) && /\]\]$/.test(s)) s = s.slice(2, -2);
      var fp = fileParts(s);
      img = { id: fp.id, raw: fp.raw, alt: fp.alt || o.caption };
    }
    return {
      k: "ibox", title: o.title ? inl(o.title) : null, img: img, cap: o.caption ? inl(o.caption) : null,
      rows: o.rows.filter(function (r) { return r[1]; }).map(function (r) { return { k: inl(r[0]), v: inl(r[1]) }; })
    };
  }
  // References in order of first use, then unused definitions.
  //   [{ key, n, uses, c (nodes) | null }]
  function buildRefs(acc) {
    var defs = acc.refDefs || {}, out = [];
    (acc.refOrder || []).forEach(function (o) {
      out.push({ key: o.key, n: out.length + 1, uses: acc.refUse[o.key] || 0, c: defs[o.key] ? defs[o.key].c : null });
    });
    Object.keys(defs).forEach(function (k) {
      if (acc.refN && acc.refN[k]) return;
      if (out.length < MAX_REFS) out.push({ key: k, n: out.length + 1, uses: 0, c: defs[k].c });
    });
    return out;
  }

  // Flat items [{lvl, ord, text}] → nested { k: "ul"|"ol", items:[{c, sub}] }
  function buildList(items, from, inl) {
    var lvl = items[from].lvl, list = { k: items[from].ord ? "ol" : "ul", items: [] }, i = from;
    while (i < items.length && items[i].lvl >= lvl && !(items[i].lvl === lvl && items[i].ord !== items[from].ord)) {
      if (items[i].lvl > lvl) {
        var subRes = buildList(items, i, inl);
        var last = list.items[list.items.length - 1];
        if (last) last.sub = subRes.list; else list.items.push({ c: [], sub: subRes.list });
        i = subRes.next;
        continue;
      }
      list.items.push({ c: inl(items[i].text) });
      i++;
    }
    return { list: list, next: i };
  }

  function uniqTitles(list) {
    var seen = {}, out = [];
    list.forEach(function (t) { var k = fold(t); if (k && !seen[k]) { seen[k] = 1; out.push(t); } });
    return out;
  }

  function inlineText(nodes) {
    return (nodes || []).map(function (n) {
      if (n.k === "t" || n.k === "code") return n.v;
      if (n.k === "wl" || n.k === "cl" || n.k === "xl") return n.v;
      if (n.k === "img") return n.alt || "";
      if (n.k === "ref") return "";
      return inlineText(n.c);
    }).join("");
  }

  // ---------- 5. Sections ----------
  // Section 0 = the lead (before the first heading); section n = the
  // n-th heading up to the next heading of the same or a higher level.
  function sectionRange(text, n) {
    var lines = str(text).split("\n"), heads = parseDoc(text).heads;
    if (n === 0) return { from: 0, to: heads.length ? heads[0].line : lines.length };
    var h = heads[n - 1];
    if (!h) return null;
    var to = lines.length;
    for (var i = n; i < heads.length; i++) if (heads[i].lvl <= h.lvl) { to = heads[i].line; break; }
    return { from: h.line, to: to };
  }
  function getSection(text, n) {
    var r = sectionRange(text, n);
    if (!r) return null;
    return str(text).split("\n").slice(r.from, r.to).join("\n").replace(/\n+$/, "");
  }
  function setSection(text, n, part) {
    var r = sectionRange(text, n);
    if (!r) return null;
    var lines = str(text).split("\n");
    var tail = lines.slice(r.to);
    var mid = str(part).replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    if (mid.length === 1 && mid[0] === "") mid = [];
    // keep one blank line before the next section
    if (tail.length && mid.length) mid.push("");
    return lines.slice(0, r.from).concat(mid, tail).join("\n");
  }

  // ---------- 6. Plain text, links, queries ----------
  function blocksText(blocks) {
    var out = [];
    (blocks || []).forEach(function (b) {
      if (b.k === "p" || b.k === "h") out.push(inlineText(b.c));
      else if (b.k === "pre") out.push(b.v);
      else if (b.k === "quote") out.push(blocksText(b.c));
      else if (b.k === "ul" || b.k === "ol") out.push(listText(b));
      else if (b.k === "table") {
        out.push(b.head.map(inlineText).join(" · "));
        b.rows.forEach(function (r) { out.push(r.map(inlineText).join(" · ")); });
      }
      else if (b.k === "fig") out.push(inlineText(b.c) || b.alt);
      else if (b.k === "gal") b.items.forEach(function (it) { out.push(inlineText(it.c) || it.alt); });
      else if (b.k === "ibox") {
        if (b.title) out.push(inlineText(b.title));
        b.rows.forEach(function (r) { out.push(inlineText(r.k) + ": " + inlineText(r.v)); });
        if (b.cap) out.push(inlineText(b.cap));
      }
    });
    return out.filter(Boolean).join("\n");
  }
  function listText(l) {
    return l.items.map(function (it) { return inlineText(it.c) + (it.sub ? "\n" + listText(it.sub) : ""); }).join("\n");
  }
  function plainText(text) {
    var d = parseDoc(text);
    var refs = d.refs.map(function (r) { return r.c ? inlineText(r.c) : ""; }).filter(Boolean);
    return blocksText(d.blocks) + (refs.length ? "\n" + refs.join("\n") : "");
  }
  function snippet(text, max) {
    var s = plainText(text).replace(/\s+/g, " ").trim();
    max = max || 160;
    return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : s;
  }

  function live(data, w) {
    return data.arts.filter(function (a) { return !w || a.w === w; });
  }
  // fold(title) → article (oldest id first when two share a title)
  function titleIndex(data, w) {
    var idx = {};
    live(data, w).slice().sort(function (a, b) { return (a.c || a.m) - (b.c || b.m) || (a.id < b.id ? -1 : 1); })
      .forEach(function (a) { var k = fold(a.t); if (!idx[k]) idx[k] = a; });
    return idx;
  }
  function byId(data, id) {
    for (var i = 0; i < data.arts.length; i++) if (data.arts[i].id === id) return data.arts[i];
    return null;
  }
  function wikiById(data, id) {
    for (var i = 0; i < data.wikis.length; i++) if (data.wikis[i].id === id) return data.wikis[i];
    return null;
  }
  // Parsed info per article, cached by revision (r is unique per text).
  var infoCache = {};
  function info(a) {
    var c = infoCache[a.id];
    if (c && c.r === a.r && c.x === a.x) return c.v;
    var d = parseDoc(a.x);
    var v = { redirect: d.redirect, links: d.links, cats: d.cats };
    infoCache[a.id] = { r: a.r, x: a.x, v: v };
    return v;
  }
  // Follow redirects (at most 3 hops, no loops).
  function resolve(data, w, title, idx) {
    idx = idx || titleIndex(data, w);
    var a = idx[fold(title)], seen = {}, from = null;
    for (var hop = 0; a && hop < 3; hop++) {
      var r = info(a).redirect;
      if (!r || seen[a.id]) break;
      seen[a.id] = 1;
      var nx = idx[fold(r)];
      if (!nx || nx.id === a.id) break;
      from = from || a;
      a = nx;
    }
    return { art: a || null, from: from };
  }
  function backlinks(data, w, art) {
    if (!art) return [];
    var keys = {};
    keys[fold(art.t)] = 1;
    // pages that redirect here count as the same title
    live(data, w).forEach(function (a) { var r = info(a).redirect; if (r && fold(r) === fold(art.t)) keys[fold(a.t)] = 1; });
    return live(data, w).filter(function (a) {
      if (a.id === art.id) return false;
      var inf = info(a);
      if (inf.redirect && keys[fold(inf.redirect)]) return true;
      return inf.links.some(function (l) { return keys[fold(l)]; });
    }).sort(byTitle);
  }
  function byTitle(a, b) {
    var x = fold(a.t), y = fold(b.t);
    return x < y ? -1 : (x > y ? 1 : (a.id < b.id ? -1 : 1));
  }
  // Titles linked but not written yet: [{ title, n (how many pages) }]
  function wanted(data, w) {
    var idx = titleIndex(data, w), map = {};
    live(data, w).forEach(function (a) {
      info(a).links.forEach(function (l) {
        var k = fold(l);
        if (idx[k]) return;
        if (!map[k]) map[k] = { title: l, n: 0, from: [] };
        map[k].n++;
        if (map[k].from.length < 5) map[k].from.push(a.id);
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.n - a.n || (fold(a.title) < fold(b.title) ? -1 : 1); });
  }
  // Categories: [{ name, arts:[art] }], sorted by name
  function categories(data, w) {
    var map = {};
    live(data, w).forEach(function (a) {
      info(a).cats.forEach(function (c) {
        var k = fold(c);
        if (!map[k]) map[k] = { name: c, arts: [] };
        map[k].arts.push(a);
      });
    });
    return Object.keys(map).sort().map(function (k) { map[k].arts.sort(byTitle); return map[k]; });
  }
  // In-app search: title hits first, then text hits.
  function search(data, w, q, max) {
    var f = fold(q);
    if (f.length < 2) return [];
    var words = f.split(" ");
    var out = [];
    live(data, w).forEach(function (a) {
      var ft = fold(a.t), score = 0;
      if (ft === f) score = 100;
      else if (ft.indexOf(f) === 0) score = 80;
      else if (ft.indexOf(f) >= 0) score = 60;
      else if (words.every(function (x) { return ft.indexOf(x) >= 0; })) score = 50;
      else {
        var body = fold(plainText(a.x));
        if (body.indexOf(f) >= 0) score = 30;
        else if (words.every(function (x) { return body.indexOf(x) >= 0; })) score = 20;
      }
      if (score) out.push({ a: a, score: score });
    });
    out.sort(function (x, y) { return y.score - x.score || byTitle(x.a, y.a); });
    return out.slice(0, max || 50).map(function (o) { return o.a; });
  }
  function suggest(data, w, q, max) {
    var f = fold(q);
    if (!f) return [];
    var pre = [], mid = [];
    live(data, w).forEach(function (a) {
      var ft = fold(a.t);
      if (ft.indexOf(f) === 0) pre.push(a); else if (ft.indexOf(f) > 0) mid.push(a);
    });
    pre.sort(byTitle); mid.sort(byTitle);
    return pre.concat(mid).slice(0, max || 8);
  }
  // Rename: optional redirect from the old title.
  // Wiki syntax word for a category link, in the language whose
  // aliases the parser knows (others write the English word).
  function catWord(lang) { return lang === "el" ? "Κατηγορία" : "Category"; }
  // Wikipedia editions offered by "Start from Wikipedia" (own names).
  var WP_LANGS = [["el", "Ελληνικά"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"],
                  ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"]];

  // ---------- 7. Diff ----------
  // Longest common subsequence on arrays, after trimming the common
  // head and tail. Big middles fall back to "all removed, all added".
  function diffSeq(a, b, eq) {
    eq = eq || function (x, y) { return x === y; };
    var s = 0, ea = a.length, eb = b.length, out = [], tail = [];
    while (s < ea && s < eb && eq(a[s], b[s])) { out.push({ op: "=", v: a[s], b: b[s] }); s++; }
    while (ea > s && eb > s && eq(a[ea - 1], b[eb - 1])) { tail.unshift({ op: "=", v: a[ea - 1], b: b[eb - 1] }); ea--; eb--; }
    var n = ea - s, m = eb - s, i, j;
    if (n * m > 4000000) {
      for (i = s; i < ea; i++) out.push({ op: "-", v: a[i] });
      for (j = s; j < eb; j++) out.push({ op: "+", v: b[j] });
      return out.concat(tail);
    }
    var L = [];
    for (i = 0; i <= n; i++) L.push(new Uint32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        L[i][j] = eq(a[s + i], b[s + j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (eq(a[s + i], b[s + j])) { out.push({ op: "=", v: a[s + i], b: b[s + j] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: "-", v: a[s + i] }); i++; }
      else { out.push({ op: "+", v: b[s + j] }); j++; }
    }
    for (; i < n; i++) out.push({ op: "-", v: a[s + i] });
    for (; j < m; j++) out.push({ op: "+", v: b[s + j] });
    return out.concat(tail);
  }
  function words(s) { return str(s).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []; }
  // Line diff; a removed line followed by an added one gets a word
  // diff (parts: [{op, v}]) so a small change inside a line shows.
  function diffText(oldText, newText) {
    var ops = diffSeq(str(oldText).split("\n"), str(newText).split("\n"));
    var rows = [], i = 0;
    while (i < ops.length) {
      var o = ops[i];
      if (o.op === "=") { rows.push({ op: "=", v: o.v }); i++; continue; }
      var dels = [], adds = [];
      while (i < ops.length && ops[i].op === "-") dels.push(ops[i++].v);
      while (i < ops.length && ops[i].op === "+") adds.push(ops[i++].v);
      var k;
      for (k = 0; k < Math.max(dels.length, adds.length); k++) {
        if (k < dels.length && k < adds.length) {
          var wd = diffSeq(words(dels[k]), words(adds[k]));
          rows.push({ op: "-", v: dels[k], parts: wd.filter(function (p) { return p.op !== "+"; }) });
          rows.push({ op: "+", v: adds[k], parts: wd.filter(function (p) { return p.op !== "-"; }).map(function (p) { return p.op === "=" ? { op: "=", v: p.b } : p; }) });
        } else if (k < dels.length) rows.push({ op: "-", v: dels[k] });
        else rows.push({ op: "+", v: adds[k] });
      }
    }
    return rows;
  }
  function diffStats(rows) {
    var a = 0, d = 0;
    rows.forEach(function (r) { if (r.op === "+") a++; else if (r.op === "-") d++; });
    return { add: a, del: d };
  }
  // Rows with only `ctx` unchanged lines kept around each change.
  function diffContext(rows, ctx) {
    ctx = ctx === undefined ? 2 : ctx;
    var keep = rows.map(function () { return false; });
    rows.forEach(function (r, i) {
      if (r.op === "=") return;
      for (var k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true;
    });
    var out = [], gap = 0;
    rows.forEach(function (r, i) {
      if (keep[i]) { if (gap) { out.push({ op: "gap", n: gap }); gap = 0; } out.push(r); }
      else gap++;
    });
    if (gap && out.length) out.push({ op: "gap", n: gap });
    return out;
  }

  // ---------- 8. Renderer ----------
  // o.state(title) → "ok" | "new"; o.edit (label for section edit
  // buttons, or ""). Links carry data-* only; the app handles clicks.
  function renderInline(doc, nodes, parent, o) {
    (nodes || []).forEach(function (n) {
      var e;
      switch (n.k) {
        case "t": parent.appendChild(doc.createTextNode(n.v)); return;
        case "code": e = doc.createElement("code"); e.textContent = n.v; break;
        case "b": e = doc.createElement("strong"); renderInline(doc, n.c, e, o); break;
        case "i": e = doc.createElement("em"); renderInline(doc, n.c, e, o); break;
        case "s": e = doc.createElement("s"); renderInline(doc, n.c, e, o); break;
        case "wl":
          e = doc.createElement("a");
          e.setAttribute("href", "#");
          e.className = "wl" + (o && o.state && o.state(n.to) === "new" ? " new" : "");
          e.setAttribute("data-to", n.to);
          if (n.frag) e.setAttribute("data-frag", n.frag);
          e.textContent = n.v;
          break;
        case "cl":
          e = doc.createElement("a");
          e.setAttribute("href", "#");
          e.className = "wl cat";
          e.setAttribute("data-cat", n.to);
          e.textContent = n.v;
          break;
        case "img": e = imgEl(doc, n.id, n.alt, n.w, n.raw); e.className += " inl"; break;
        case "ref":
          e = doc.createElement("sup");
          e.className = "ref";
          e.setAttribute("id", "cite-" + slug(n.key) + "-" + n.i);
          var ra = doc.createElement("a");
          ra.setAttribute("href", "#");
          ra.setAttribute("data-ref", slug(n.key));
          ra.textContent = "[" + n.n + "]";
          e.appendChild(ra);
          break;
        case "xl":
          e = doc.createElement("a");
          e.setAttribute("href", n.href);
          e.setAttribute("target", "_blank");
          e.setAttribute("rel", "noopener noreferrer nofollow");
          e.className = "xl";
          e.textContent = n.v;
          break;
        default: return;
      }
      parent.appendChild(e);
    });
  }
  // A picture: never a src here. The app sets it from the orOS disk
  // (a blob: URL) for elements with data-img, so markup can never
  // point an <img> at the web.
  function imgEl(doc, id, alt, w, raw) {
    if (!IMG_RE.test(str(id))) {
      var bad = doc.createElement("span");
      bad.className = "img-bad";
      bad.textContent = str(alt) || str(raw) || "?";
      return bad;
    }
    var im = doc.createElement("img");
    im.className = "wimg";
    im.setAttribute("data-img", id);
    im.setAttribute("alt", str(alt));
    im.setAttribute("loading", "lazy");
    if (w) im.setAttribute("width", String(int(w)));
    return im;
  }
  function figure(doc, id, alt, w, raw, cap, cls, o) {
    var f = doc.createElement("figure");
    f.className = cls;
    f.appendChild(imgEl(doc, id, alt || inlineText(cap), w, raw));
    if (cap && cap.length) {
      var fc = doc.createElement("figcaption");
      renderInline(doc, cap, fc, o);
      f.appendChild(fc);
    }
    return f;
  }
  function renderRefs(doc, refs, o) {
    var ol = doc.createElement("ol");
    ol.className = "refs";
    refs.forEach(function (r) {
      var li = doc.createElement("li");
      li.setAttribute("id", "ref-" + slug(r.key));
      li.setAttribute("value", String(r.n));
      if (r.uses) {
        var up = doc.createElement("a");
        up.setAttribute("href", "#");
        up.className = "ref-up";
        up.setAttribute("data-cite", "cite-" + slug(r.key) + "-1");
        up.setAttribute("aria-label", (o && o.refUp) || "↑");
        up.textContent = "↑";
        li.appendChild(up);
        li.appendChild(doc.createTextNode(" "));
      }
      if (r.c) renderInline(doc, r.c, li, o);
      else {
        var miss = doc.createElement("span");
        miss.className = "ref-miss";
        miss.textContent = (o && o.refMissing) || "?";
        li.appendChild(miss);
      }
      ol.appendChild(li);
    });
    return ol;
  }
  function renderBlocks(doc, blocks, parent, o) {
    (blocks || []).forEach(function (b) {
      var e;
      switch (b.k) {
        case "fig":
          e = figure(doc, b.id, b.alt, b.w, b.raw, b.c, "fig fig-" + (ALIGN[b.al] || "right"), o);
          if (b.w && b.al !== "none") e.style.width = int(b.w) + "px";
          break;
        case "gal":
          e = doc.createElement("div");
          e.className = "gal";
          b.items.forEach(function (it) { e.appendChild(figure(doc, it.id, it.alt, 0, it.raw, it.c, "gal-item", o)); });
          break;
        case "ibox":
          e = doc.createElement("aside");
          e.className = "ibox";
          if (b.title) {
            var it2 = doc.createElement("div");
            it2.className = "ibox-t";
            renderInline(doc, b.title, it2, o);
            e.appendChild(it2);
          }
          if (b.img) e.appendChild(figure(doc, b.img.id, b.img.alt, 0, b.img.raw, b.cap, "ibox-img", o));
          else if (b.cap) { var ic = doc.createElement("div"); ic.className = "ibox-cap"; renderInline(doc, b.cap, ic, o); e.appendChild(ic); }
          if (b.rows.length) {
            var tb2 = doc.createElement("table"), bd2 = doc.createElement("tbody");
            b.rows.forEach(function (r) {
              var tr2 = doc.createElement("tr"), th2 = doc.createElement("th"), td3 = doc.createElement("td");
              th2.setAttribute("scope", "row");
              renderInline(doc, r.k, th2, o);
              renderInline(doc, r.v, td3, o);
              tr2.appendChild(th2); tr2.appendChild(td3);
              bd2.appendChild(tr2);
            });
            tb2.appendChild(bd2);
            e.appendChild(tb2);
          }
          break;
        case "refs":
          if (!o || !o._refs || !o._refs.length) return;
          o._refsDone = true;
          e = renderRefs(doc, o._refs, o);
          break;
        case "p": e = doc.createElement("p"); renderInline(doc, b.c, e, o); break;
        case "h":
          e = doc.createElement("h" + b.lvl);
          e.id = "s-" + b.anchor;
          e.className = "sh";
          var span = doc.createElement("span");
          span.className = "sh-t";
          renderInline(doc, b.c, span, o);
          e.appendChild(span);
          if (o && o.edit && b.n) {
            var btn = doc.createElement("button");
            btn.setAttribute("type", "button");
            btn.className = "sec-edit";
            btn.setAttribute("data-sec", String(b.n));
            btn.textContent = o.edit;
            e.appendChild(btn);
          }
          break;
        case "hr": e = doc.createElement("hr"); break;
        case "pre":
          e = doc.createElement("pre");
          var c = doc.createElement("code");
          c.textContent = b.v;
          e.appendChild(c);
          break;
        case "quote": e = doc.createElement("blockquote"); renderBlocks(doc, b.c, e, o); break;
        case "ul": case "ol": e = renderList(doc, b, o); break;
        case "table":
          e = doc.createElement("div");
          e.className = "tbl-wrap";
          var tb = doc.createElement("table"), th = doc.createElement("thead"), tr = doc.createElement("tr");
          b.head.forEach(function (cell, ci) {
            var td = doc.createElement("th");
            if (b.al[ci]) td.style.textAlign = b.al[ci];
            renderInline(doc, cell, td, o);
            tr.appendChild(td);
          });
          th.appendChild(tr); tb.appendChild(th);
          var body = doc.createElement("tbody");
          b.rows.forEach(function (row) {
            var r = doc.createElement("tr");
            for (var ci = 0; ci < Math.max(row.length, b.head.length); ci++) {
              var td2 = doc.createElement("td");
              if (b.al[ci]) td2.style.textAlign = b.al[ci];
              renderInline(doc, row[ci] || [], td2, o);
              r.appendChild(td2);
            }
            body.appendChild(r);
          });
          tb.appendChild(body);
          e.appendChild(tb);
          break;
        default: return;
      }
      parent.appendChild(e);
    });
  }
  function renderList(doc, l, o) {
    var e = doc.createElement(l.k);
    l.items.forEach(function (it) {
      var li = doc.createElement("li");
      renderInline(doc, it.c, li, o);
      if (it.sub) li.appendChild(renderList(doc, it.sub, o));
      e.appendChild(li);
    });
    return e;
  }
  // Whole article: lead, then (with 3+ headings) the Contents box,
  // then the sections; level-2 sections are wrapped so a phone can
  // fold them. Returns a DocumentFragment.
  function render(doc, parsed, o) {
    o = o || {};
    o._refs = parsed.refs || [];
    o._refsDone = false;
    var frag = doc.createDocumentFragment();
    renderBody(doc, parsed, o, frag);
    if (o._refs.length && !o._refsDone) {
      // no {{references}} line: the list goes in its own last section
      var rs = doc.createElement("section");
      rs.className = "sec refs-sec";
      var rh = doc.createElement("h2");
      rh.className = "sh";
      rh.setAttribute("id", "s-refs");
      var rt = doc.createElement("span");
      rt.className = "sh-t";
      rt.textContent = o.refs || "References";
      rh.appendChild(rt);
      rs.appendChild(rh);
      var rb = doc.createElement("div");
      rb.className = "sec-body";
      rb.appendChild(renderRefs(doc, o._refs, o));
      rs.appendChild(rb);
      frag.appendChild(rs);
    }
    return frag;
  }
  function renderBody(doc, parsed, o, frag) {
    var blocks = parsed.blocks, i = 0;
    var lead = doc.createElement("div");
    lead.className = "lead";
    var firstHead = -1;
    for (var k = 0; k < blocks.length; k++) if (blocks[k].k === "h") { firstHead = k; break; }
    renderBlocks(doc, firstHead < 0 ? blocks : blocks.slice(0, firstHead), lead, o);
    frag.appendChild(lead);
    if (firstHead < 0) return;
    if (o.toc && parsed.heads && parsed.heads.length >= 3) frag.appendChild(renderToc(doc, parsed.heads, o.toc));
    i = firstHead;
    var sec = null, secBody = null;
    for (; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.k === "h" && b.lvl === 2) {
        sec = doc.createElement("section");
        sec.className = "sec";
        renderBlocks(doc, [b], sec, o);
        secBody = doc.createElement("div");
        secBody.className = "sec-body";
        sec.appendChild(secBody);
        frag.appendChild(sec);
        continue;
      }
      renderBlocks(doc, [b], secBody || frag, o);
    }
  }
  function renderToc(doc, heads, label) {
    var box = doc.createElement("nav");
    box.className = "toc";
    var h = doc.createElement("div");
    h.className = "toc-h";
    h.textContent = label;
    box.appendChild(h);
    var ol = doc.createElement("ol"), stack = [ol], nums = [0, 0, 0];
    heads.forEach(function (x) {
      var d = Math.max(0, Math.min(2, x.lvl - 2));
      while (stack.length - 1 < d) {
        var last = stack[stack.length - 1].lastElementChild || stack[stack.length - 1].appendChild(doc.createElement("li"));
        var sub = doc.createElement("ol");
        last.appendChild(sub);
        stack.push(sub);
        nums[stack.length - 1] = 0;
      }
      while (stack.length - 1 > d) stack.pop();
      nums[d]++;
      for (var z = d + 1; z < 3; z++) nums[z] = 0;
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.setAttribute("href", "#");
      a.setAttribute("data-anchor", x.anchor);
      var num = doc.createElement("span");
      num.className = "toc-n";
      num.textContent = nums.slice(0, d + 1).join(".");
      a.appendChild(num);
      a.appendChild(doc.createTextNode(" " + x.text));
      li.appendChild(a);
      stack[stack.length - 1].appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  // ---------- 9. Revisions ----------
  // One immutable file per saved revision, never rewritten:
  //   /internal/Wiki/History/<article id>/<m padded>-<rev id>.json
  // Vault Drive syncs them per file; the slice never holds history.
  function revDir(aid) { return HIST_DIR + "/" + aid; }
  function revName(m, r) { return ("0000000000000" + int(m)).slice(-13) + "-" + r + ".json"; }
  function revPath(aid, m, r) { return revDir(aid) + "/" + revName(m, r); }
  var REV_FILE_RE = /^(\d{13})-(r[0-9a-z]{6,24})\.json$/;
  function parseRevName(name) {
    var m = REV_FILE_RE.exec(str(name));
    return m ? { m: Number(m[1]), r: m[2] } : null;
  }
  function revFile(art, prev, dev) {
    return { v: 1, a: art.id, w: art.w, r: art.r, p: prev || "", m: art.m, t: art.t, x: art.x, s: art.s || "", dev: str(dev).slice(0, 40) };
  }
  function parseRevFile(raw) {
    var o;
    try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!isObj(o) || !REV_RE.test(str(o.r)) || !ART_RE.test(str(o.a))) return null;
    return { a: o.a, r: o.r, p: REV_RE.test(str(o.p)) ? o.p : "", m: int(o.m), t: cleanTitle(o.t), x: str(o.x).slice(0, MAX_TEXT),
             s: str(o.s).replace(/\s+/g, " ").trim().slice(0, MAX_SUM), dev: str(o.dev).slice(0, 40) };
  }

  // ---------- 10. Editing helpers ----------
  // Pure text helpers behind the toolbar dialogs (tables, infobox,
  // citations). They read and write the markup, nothing else.

  // A table cell as markup: one line, | outside [[ ]] / `code` escaped.
  function escCell(s) {
    s = str(s).replace(/\s*\n\s*/g, " ").trim();
    var out = "", link = 0, code = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\" && i + 1 < s.length) { out += c + s.charAt(i + 1); i++; continue; }
      if (!code && c === "[" && s.charAt(i + 1) === "[") { link++; out += "[["; i++; continue; }
      if (!code && link && c === "]" && s.charAt(i + 1) === "]") { link--; out += "]]"; i++; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !link && !code) { out += "\\|"; continue; }
      out += c;
    }
    return out;
  }
  function tableText(head, rows, al) {
    var n = Math.max(1, (head || []).length);
    (rows || []).forEach(function (r) { n = Math.max(n, r.length); });
    function row(cells) {
      var out = [];
      for (var i = 0; i < n; i++) out.push(escCell(cells[i] || ""));
      return "| " + out.join(" | ") + " |";
    }
    var sep = [];
    for (var i = 0; i < n; i++) {
      var a = (al || [])[i];
      sep.push(a === "center" ? ":---:" : (a === "right" ? "---:" : (a === "left" ? ":---" : "---")));
    }
    return [row(head || []), "|" + sep.join("|") + "|"].concat((rows || []).map(row)).join("\n");
  }
  // Line offsets of a text: [{ s (start), e (end, without \n), l (line) }]
  function lineMap(text) {
    var lines = str(text).split("\n"), off = 0;
    return lines.map(function (l) { var o = { s: off, e: off + l.length, l: l }; off += l.length + 1; return o; });
  }
  function lineAt(map, pos) {
    for (var i = 0; i < map.length; i++) if (pos <= map[i].e) return i;
    return map.length - 1;
  }
  // The table around a caret position, or null:
  //   { start, end, head:[cell], al:[align], rows:[[cell]] }
  function tableAt(text, pos) {
    var map = lineMap(text), at = lineAt(map, pos);
    function isRow(i) { return i >= 0 && i < map.length && /^\s*\|/.test(map[i].l); }
    if (!isRow(at)) return null;
    var a = at, b = at;
    while (isRow(a - 1)) a--;
    while (isRow(b + 1)) b++;
    if (b - a < 1 || !RE_TSEP.test(map[a + 1].l) || map[a + 1].l.indexOf("-") < 0) return null;
    return {
      start: map[a].s, end: map[b].e, head: splitCells(map[a].l), al: aligns(map[a + 1].l),
      rows: map.slice(a + 2, b + 1).map(function (x) { return splitCells(x.l); })
    };
  }
  // Template blocks of the text (outside ``` code):
  //   [{ kind: "ibox"|"gal", start, end, body:[line] }]
  function templates(text) {
    var map = lineMap(text), out = [], fence = false;
    for (var i = 0; i < map.length; i++) {
      if (RE_FENCE.test(map[i].l)) { fence = !fence; continue; }
      if (fence) continue;
      var m = RE_TPL.exec(map[i].l), kind = tplKind(m);
      if (!kind || kind === "refs" || m[2]) continue;
      var j = i + 1;
      while (j < map.length && !RE_TPL_END.test(map[j].l)) j++;
      var last = Math.min(j, map.length - 1);
      out.push({ kind: kind, start: map[i].s, end: map[last].e, body: map.slice(i + 1, j).map(function (x) { return x.l; }) });
      i = last;
    }
    return out;
  }
  // The block of `kind` around pos, else the first one, else null.
  function blockAt(text, pos, kind) {
    var list = templates(text).filter(function (b) { return b.kind === kind; });
    for (var i = 0; i < list.length; i++) if (pos >= list[i].start && pos <= list[i].end) return list[i];
    return list[0] || null;
  }
  // Infobox fields as text: { title, image (asset id or ""), caption, rows:[[k, v]] }
  function iboxParse(body) {
    var o = iboxRaw(body || []);
    var s = o.image.trim();
    if (/^\[\[/.test(s) && /\]\]$/.test(s)) s = s.slice(2, -2);
    o.image = s ? fileParts(s).id : "";
    return o;
  }
  function iboxText(o, lang) {
    var el = lang === "el";
    function one(v) { return str(v).replace(/\s*\n\s*/g, " ").trim(); }
    function key(k) { return one(k).replace(/[=|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); }
    var out = [el ? "{{πλαίσιο" : "{{infobox"];
    if (one(o.title)) out.push("| " + (el ? "τίτλος" : "title") + " = " + one(o.title));
    if (IMG_RE.test(str(o.image))) out.push("| " + (el ? "εικόνα" : "image") + " = " + (el ? "Αρχείο:" : "File:") + o.image);
    if (one(o.caption)) out.push("| " + (el ? "λεζάντα" : "caption") + " = " + one(o.caption));
    (o.rows || []).slice(0, MAX_IBOX).forEach(function (r) {
      var k = key(r[0]), v = one(r[1]);
      if (k && !IBOX_KEY[fold(k)]) out.push("| " + k + " = " + v);
    });
    out.push("}}");
    return out.join("\n");
  }
  // A picture line: [[File:id|right|250px|Caption]]
  function fileText(id, o, lang) {
    o = o || {};
    var parts = [(lang === "el" ? "Αρχείο:" : "File:") + id];
    if (o.al && ALIGN[o.al] && o.al !== "right") parts.push(o.al);
    if (o.w) parts.push(Math.max(40, Math.min(1200, int(o.w))) + "px");
    var cap = str(o.cap).replace(/\s*\n\s*/g, " ").trim();
    if (cap) parts.push(cap.replace(/\|/g, "\\|").replace(/\]\]/g, "] ]"));
    return "[[" + parts.join("|") + "]]";
  }
  function galleryText(items, lang) {
    var p = lang === "el" ? "Αρχείο:" : "File:";
    return [lang === "el" ? "{{γκαλερί" : "{{gallery"].concat((items || []).slice(0, MAX_GAL).map(function (it) {
      var cap = str(it.cap).replace(/\s*\n\s*/g, " ").trim().replace(/\|/g, "\\|");
      return p + it.id + (cap ? "|" + cap : "");
    })).concat(["}}"]).join("\n");
  }

  // Citation text for "[^n]: …". kind: book | web | person | note.
  // L: labels { pages, isbn, retrieved, interview } in the reader's language.
  function escMd(s) { return str(s).replace(/\s*\n\s*/g, " ").trim().replace(/[\\`*_~\[\]|^{}]/g, "\\$&"); }
  function citeText(kind, f, L) {
    f = f || {}; L = L || {};
    var v = function (k) { return escMd(f[k]); };
    var out = [];
    if (kind === "book") {
      if (v("author")) out.push(v("author") + ".");
      if (v("title")) out.push("*" + v("title") + "*.");
      var pub = [v("publisher"), v("place")].filter(Boolean).join(", ");
      if (pub || v("year")) out.push([pub, v("year")].filter(Boolean).join(", ") + ".");
      if (v("pages")) out.push((L.pages || "p.") + " " + v("pages") + ".");
      if (v("isbn")) out.push("ISBN " + v("isbn") + ".");
    } else if (kind === "web") {
      var url = safeUrl(f.url), title = v("title") || (url ? escMd(url) : "");
      if (title) out.push((url ? "[" + title + "](" + url + ")" : title) + ".");
      if (v("author")) out.push(v("author") + ".");
      if (v("site")) out.push("*" + v("site") + "*.");
      if (v("date")) out.push((L.retrieved || "Retrieved") + " " + v("date") + ".");
    } else if (kind === "person") {
      if (v("name")) out.push(v("name") + (v("role") ? ", " + v("role") : "") + ".");
      if (v("how") || v("date")) out.push([v("how") || L.interview || "", v("date")].filter(Boolean).join(", ") + ".");
    } else {
      if (v("text")) out.push(v("text"));
    }
    return out.join(" ").replace(/\.\./g, ".").trim();
  }
  // Next free numeric reference name in a text.
  function nextRefName(text) {
    var max = 0, re = /\[\^(\d{1,6})\]/g, m;
    while ((m = re.exec(str(text)))) max = Math.max(max, Number(m[1]));
    return String(max + 1);
  }
  // Insert [^name] at pos and its definition near the end of the text
  // (before the trailing category lines). → { text, pos (after the mark) }
  function addRef(text, pos, name, def) {
    text = str(text);
    pos = Math.max(0, Math.min(text.length, int(pos)));
    var mark = "[^" + name + "]";
    var lines = (text.slice(0, pos) + mark + text.slice(pos)).split("\n");
    var k = lines.length;
    var catLine = /^\s*(\[\[\s*(category|κατηγορία|κατηγορια)\s*:[^\]]*\]\]\s*)+$/i;
    while (k > 0 && (!lines[k - 1].trim() || catLine.test(lines[k - 1]))) k--;
    var line = "[^" + name + "]: " + str(def).replace(/\s*\n\s*/g, " ").trim();
    var add = k > 0 && !RE_REFDEF.test(lines[k - 1]) ? ["", line] : [line];
    if (k < lines.length) add.push("");
    lines.splice.apply(lines, [k, 0].concat(add));
    var out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
    return { text: out, pos: pos + mark.length };
  }
  // Every picture id used by a parsed article, in order, once.
  function images(parsed) {
    var seen = {}, out = [];
    function add(id) { if (IMG_RE.test(str(id)) && !seen[id]) { seen[id] = 1; out.push(id); } }
    function inl(nodes) { (nodes || []).forEach(function (n) { if (n.k === "img") add(n.id); if (n.c) inl(n.c); }); }
    function list(l) { l.items.forEach(function (it) { inl(it.c); if (it.sub) list(it.sub); }); }
    function blocks(bs) {
      (bs || []).forEach(function (b) {
        if (b.k === "fig") { add(b.id); inl(b.c); }
        else if (b.k === "gal") b.items.forEach(function (it) { add(it.id); inl(it.c); });
        else if (b.k === "ibox") { if (b.img) add(b.img.id); inl(b.title); inl(b.cap); b.rows.forEach(function (r) { inl(r.k); inl(r.v); }); }
        else if (b.k === "p" || b.k === "h") inl(b.c);
        else if (b.k === "quote") blocks(b.c);
        else if (b.k === "ul" || b.k === "ol") list(b);
        else if (b.k === "table") { b.head.forEach(inl); b.rows.forEach(function (r) { r.forEach(inl); }); }
      });
    }
    blocks(parsed && parsed.blocks);
    ((parsed && parsed.refs) || []).forEach(function (r) { inl(r.c); });
    return out;
  }

  var API = {
    VERSION: VERSION, DATA_KEY: DATA_KEY, PREFS_KEY: PREFS_KEY, DRAFT_KEY: DRAFT_KEY,
    MAX_TEXT: MAX_TEXT, MAX_ARTS: MAX_ARTS, MAX_WIKIS: MAX_WIKIS, MAX_ANC: MAX_ANC, MAX_SUM: MAX_SUM,
    WIKI_RE: WIKI_RE, ART_RE: ART_RE, REV_RE: REV_RE, HIST_DIR: HIST_DIR,
    uid: uid, cleanTitle: cleanTitle, fold: fold, slug: slug, safeUrl: safeUrl,
    empty: empty, normWiki: normWiki, normArt: normArt, normData: normData, mergeArt: mergeArt,
    merge: merge, parse: parse, normPrefs: normPrefs, canon: canon,
    parseInline: parseInline, parseDoc: parseDoc, inlineText: inlineText, splitCells: splitCells,
    sectionRange: sectionRange, getSection: getSection, setSection: setSection,
    plainText: plainText, snippet: snippet, live: live, titleIndex: titleIndex, byId: byId, wikiById: wikiById,
    info: info, resolve: resolve, backlinks: backlinks, wanted: wanted, categories: categories,
    search: search, suggest: suggest, byTitle: byTitle, catWord: catWord, WP_LANGS: WP_LANGS,
    diffSeq: diffSeq, diffText: diffText, diffStats: diffStats, diffContext: diffContext,
    render: render, renderInline: renderInline, renderBlocks: renderBlocks, renderToc: renderToc,
    revDir: revDir, revName: revName, revPath: revPath, parseRevName: parseRevName, revFile: revFile, parseRevFile: parseRevFile,
    IMG_RE: IMG_RE, fileParts: fileParts, fileEnd: fileEnd, splitTop: splitTop, renderRefs: renderRefs,
    escCell: escCell, tableText: tableText, tableAt: tableAt, templates: templates, blockAt: blockAt,
    iboxParse: iboxParse, iboxText: iboxText, fileText: fileText, galleryText: galleryText,
    escMd: escMd, citeText: citeText, nextRefName: nextRefName, addRef: addRef, images: images
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.WikiCore = API;
})(typeof window !== "undefined" ? window : globalThis);
