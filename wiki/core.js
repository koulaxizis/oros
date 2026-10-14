// ============================================================
// orOS Wiki — pure core (v1.0.0)
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
// Exposes window.WikiCore (browser) / module.exports (Node).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION = "1.0.0";
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
  var MAX_DEPTH = 4;

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
      if (c === "\\" && i + 1 < n && /[\\`*_~\[\]()#|>!=-]/.test(s.charAt(i + 1))) { buf += s.charAt(i + 1); i += 2; continue; }
      if (c === "`") {
        var e = s.indexOf("`", i + 1);
        if (e > i + 1) { flush(); nodes.push({ k: "code", v: s.slice(i + 1, e) }); i = e + 1; continue; }
      }
      if (c === "[" && s.charAt(i + 1) === "[") {
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
    }
    return res;
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
    });
    return out.filter(Boolean).join("\n");
  }
  function listText(l) {
    return l.items.map(function (it) { return inlineText(it.c) + (it.sub ? "\n" + listText(it.sub) : ""); }).join("\n");
  }
  function plainText(text) {
    var d = parseDoc(text);
    return blocksText(d.blocks);
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
  function welcomeText(lang) {
    return lang === "el"
      ? "Καλώς ήρθες στο wiki σου. Εδώ γράφεις ό,τι θέλεις να θυμάσαι, σε άρθρα που συνδέονται μεταξύ τους.\n\n## Πρώτα βήματα\n- Πάτα **Επεξεργασία** για να αλλάξεις αυτή τη σελίδα.\n- Γράψε έναν τίτλο σε διπλές αγκύλες, όπως [[Το πρώτο μου άρθρο]], και πάτα τον για να γράψεις το άρθρο.\n- Βάλε ένα άρθρο σε κατηγορία με [[:Κατηγορία:Παράδειγμα|Κατηγορία:Παράδειγμα]] στο κείμενό του.\n"
      : "Welcome to your wiki. Write down what you want to remember, in articles that link to each other.\n\n## First steps\n- Press **Edit** to change this page.\n- Write a title in double square brackets, like [[My first article]], and tap it to write that article.\n- File an article in a category with [[:Category:Example|Category:Example]] in its text.\n";
  }

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
  function renderBlocks(doc, blocks, parent, o) {
    (blocks || []).forEach(function (b) {
      var e;
      switch (b.k) {
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
    var frag = doc.createDocumentFragment();
    var blocks = parsed.blocks, i = 0;
    var lead = doc.createElement("div");
    lead.className = "lead";
    var firstHead = -1;
    for (var k = 0; k < blocks.length; k++) if (blocks[k].k === "h") { firstHead = k; break; }
    renderBlocks(doc, firstHead < 0 ? blocks : blocks.slice(0, firstHead), lead, o);
    frag.appendChild(lead);
    if (firstHead < 0) return frag;
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
    return frag;
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
    search: search, suggest: suggest, byTitle: byTitle, welcomeText: welcomeText,
    diffSeq: diffSeq, diffText: diffText, diffStats: diffStats, diffContext: diffContext,
    render: render, renderInline: renderInline, renderBlocks: renderBlocks, renderToc: renderToc,
    revDir: revDir, revName: revName, revPath: revPath, parseRevName: parseRevName, revFile: revFile, parseRevFile: parseRevFile
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.WikiCore = API;
})(typeof window !== "undefined" ? window : globalThis);
