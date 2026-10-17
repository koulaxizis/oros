// ============================================================
// orOS Notes — Markdown core (notes/md.js, window.OrosNotesMd)
// Everything here is pure (no DOM), so the app and `node --test`
// run the same code:
//   1. render(text, ctx)   page text → SAFE HTML string. Every
//      character of the text is escaped; only allow-listed tags are
//      built (h1–h6 p br strong em del code pre blockquote ul ol li
//      input[checkbox] table thead tbody tr th td hr a). Links: only
//      http:, https:, mailto: (target _blank, rel noopener). Wiki
//      links [[Target]] / [[Target|label]] become <a data-wiki> that
//      the app opens itself. No raw HTML, no images, no attributes
//      from the text except an escaped href / data-wiki value.
//   2. toggleTask(text, line)  flips "- [ ]" ↔ "- [x]" on one line.
//   3. format(text, a, b, kind)  the editor toolbar (bold, italic,
//      heading, list, task, link, code) on a textarea selection.
//   4. Wiki-link resolution across notebooks (index + resolve).
//   5. Templates: fillTemplate, ymd, hm.
// Storage never changes: pages stay plain text (Markdown source).
// ============================================================
(function (root) {
  "use strict";

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  var MAX_DEPTH = 8;

  // Only these schemes become links; everything else stays text.
  function safeUrl(u) {
    u = String(u || "").trim();
    if (u.charAt(0) === "<" && u.charAt(u.length - 1) === ">") u = u.slice(1, -1).trim();
    if (!u || u.length > 2048) return null;
    if (/[\s\u0000-\u001f\u007f<>\u0022\u0060]/.test(u)) return null;
    if (!/^(https?:\/\/[^\/]|mailto:[^\/])/i.test(u)) return null;
    return u;
  }

  function isWs(c) { return c === "" || /\s/.test(c); }
  function isAlnum(c) { return !!c && /[0-9A-Za-z\u00c0-\u024f\u0370-\u03ff\u1f00-\u1fff\u0400-\u04ff]/.test(c); }

  // ---------- 1a. inline ----------
  function wikiParts(inner) {
    var bar = inner.indexOf("|");
    var target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    var label = (bar === -1 ? target : inner.slice(bar + 1).trim()) || target;
    return { target: target, label: label };
  }

  function inline(s, ctx, depth) {
    if (depth > MAX_DEPTH) return esc(s).replace(/\n/g, "<br>\n");
    var out = "", i = 0, n = s.length, fail = {};
    while (i < n) {
      var c = s.charAt(i);
      // backslash escape
      if (c === "\\" && i + 1 < n && PUNCT.indexOf(s.charAt(i + 1)) !== -1) {
        out += esc(s.charAt(i + 1)); i += 2; continue;
      }
      if (c === "\n") { out += "<br>\n"; i++; continue; }
      // code span
      if (c === "`") {
        var run = 1;
        while (s.charAt(i + run) === "`") run++;
        var fence = s.substr(i, run), j = -1;
        if (!fail["`" + run]) {
          var from = i + run;
          while (true) {
            j = s.indexOf(fence, from);
            if (j === -1) break;
            if (s.charAt(j + run) !== "`" && s.charAt(j - 1) !== "`") break;
            from = j + 1;
            while (s.charAt(from) === "`") from++;
          }
          if (j === -1) fail["`" + run] = 1;
        }
        if (j !== -1) {
          var code = s.slice(i + run, j).replace(/\n/g, " ");
          if (code.length > 2 && code.charAt(0) === " " && code.charAt(code.length - 1) === " " && code.trim()) code = code.slice(1, -1);
          out += "<code>" + esc(code) + "</code>";
          i = j + run; continue;
        }
        out += esc(fence); i += run; continue;
      }
      // wiki link [[Target]] / [[Target|label]]
      if (c === "[" && s.charAt(i + 1) === "[") {
        var k = s.indexOf("]]", i + 2);
        if (k !== -1) {
          var inner = s.slice(i + 2, k);
          if (inner.trim() && !/[\[\]\n]/.test(inner)) {
            var wp = wikiParts(inner);
            if (wp.target) {
              var st = ctx && typeof ctx.wiki === "function" ? ctx.wiki(wp.target) : "";
              var cls = (st === "ok" || st === "amb" || st === "new") ? " " + st : "";
              out += '<a class="md-wiki' + cls + '" role="link" tabindex="0" data-wiki="' + esc(wp.target) + '">' + esc(wp.label) + "</a>";
              i = k + 2; continue;
            }
          }
        }
      }
      // [text](url)
      if (c === "[") {
        var lk = parseLink(s, i);
        if (lk) {
          var label = inline(lk.text, ctx, depth + 1);
          var url = safeUrl(lk.url);
          if (url) out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + (label || esc(url)) + "</a>";
          else out += label;
          i = lk.end; continue;
        }
      }
      // bare http(s) URL
      if ((c === "h" || c === "H") && !isAlnum(s.charAt(i - 1))) {
        var re = /https?:\/\/[^\s<>"'`]+/gi;
        re.lastIndex = i;
        var um = re.exec(s);
        if (um && um.index === i) {
          var raw = um[0].replace(/[.,;:!?)\]*_~]+$/, "");
          var su = safeUrl(raw);
          if (su) {
            out += '<a href="' + esc(su) + '" target="_blank" rel="noopener noreferrer">' + esc(raw) + "</a>";
            i += raw.length; continue;
          }
        }
      }
      // strong / strike / em
      if (c === "*" || c === "_" || (c === "~" && s.charAt(i + 1) === "~")) {
        var em = emphasis(s, i, ctx, depth, fail);
        if (em) { out += em.html; i = em.end; continue; }
      }
      out += esc(c); i++;
    }
    return out;
  }

  // [text](url "title") starting at i ("[") → { text, url, end } | null
  function parseLink(s, i) {
    var d = 0, j = i;
    for (; j < s.length; j++) {
      var ch = s.charAt(j);
      if (ch === "\\") { j++; continue; }
      if (ch === "[") d++;
      else if (ch === "]") { d--; if (d === 0) break; }
      else if (ch === "\n" && s.charAt(j + 1) === "\n") return null;
    }
    if (j >= s.length || s.charAt(j + 1) !== "(") return null;
    var k = j + 2, pd = 1;
    for (; k < s.length; k++) {
      var c2 = s.charAt(k);
      if (c2 === "\n") return null;
      if (c2 === "(") pd++;
      else if (c2 === ")") { pd--; if (pd === 0) break; }
    }
    if (k >= s.length) return null;
    var dest = s.slice(j + 2, k).trim().replace(/\s+("[^"]*"|'[^']*')$/, "");
    return { text: s.slice(i + 1, j), url: dest, end: k + 1 };
  }

  function emphasis(s, i, ctx, depth, fail) {
    var c = s.charAt(i);
    var dbl = s.charAt(i + 1) === c;
    if (c === "~" && !dbl) return null;
    var d = dbl ? c + c : c;
    var L = d.length;
    var after = s.charAt(i + L);
    if (isWs(after)) return null;                       // opener must touch text
    if (c === "_" && isAlnum(s.charAt(i - 1))) return null;   // snake_case stays
    if (fail[d]) return null;
    var from = i + L;
    while (true) {
      var j = s.indexOf(d, from);
      if (j === -1) { fail[d] = 1; return null; }
      var prev = s.charAt(j - 1);
      var nxt = s.charAt(j + L);
      if (!dbl && nxt === c) {                            // part of a "**" run: skip the run
        from = j;
        while (s.charAt(from) === c) from++;
        continue;
      }
      if (isWs(prev) || j <= i + L) { from = j + 1; continue; }
      if (c === "_" && isAlnum(nxt)) { from = j + 1; continue; }
      if (dbl) while (s.charAt(j + L) === c) j++;         // "***x***": inner keeps one
      if (s.slice(i + L, j).indexOf("\n\n") !== -1) { from = j + 1; continue; }
      var tag = c === "~" ? "del" : (dbl ? "strong" : "em");
      return { html: "<" + tag + ">" + inline(s.slice(i + L, j), ctx, depth + 1) + "</" + tag + ">", end: j + L };
    }
  }

  // ---------- 1b. blocks ----------
  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/;
  var RE_HEAD  = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var RE_HR    = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_ITEM  = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/;
  var RE_TASK  = /^\[([ xX])\](?:[ \t]+|$)([\s\S]*)$/;
  var RE_SEP   = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

  function blank(s) { return /^\s*$/.test(s); }
  function indentOf(ws) { return ws.replace(/\t/g, "    ").length; }

  function splitRow(s) {
    s = s.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|" && s.charAt(s.length - 2) !== "\\") s = s.slice(0, -1);
    var cells = [], cur = "", inCode = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "\\" && s.charAt(i + 1) === "|") { cur += "|"; i++; continue; }
      if (ch === "`") inCode = !inCode;
      if (ch === "|" && !inCode) { cells.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells.slice(0, 64);
  }

  function isTableStart(L, i) {
    if (i + 1 >= L.length) return false;
    var a = L[i].s, b = L[i + 1].s;
    if (a.indexOf("|") === -1 || !RE_SEP.test(b) || b.indexOf("-") === -1) return false;
    if (b.indexOf("|") === -1 && !/^\s*\|/.test(a)) return false;
    return splitRow(a).length === splitRow(b).length;
  }

  function startsBlock(L, i) {
    var s = L[i].s;
    return RE_FENCE.test(s) || RE_HEAD.test(s) || RE_HR.test(s) || RE_QUOTE.test(s) ||
           RE_ITEM.test(s) || isTableStart(L, i);
  }

  function blocks(L, ctx, depth) {
    var out = "", i = 0;
    while (i < L.length) {
      var s = L[i].s, m;
      if (blank(s)) { i++; continue; }
      // fenced code
      if ((m = RE_FENCE.exec(s)) && !(m[1].charAt(0) === "`" && m[2].indexOf("`") !== -1)) {
        var fch = m[1].charAt(0), flen = m[1].length, code = [];
        i++;
        while (i < L.length) {
          var cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(L[i].s);
          if (cm && cm[1].charAt(0) === fch && cm[1].length >= flen) { i++; break; }
          code.push(L[i].s); i++;
        }
        out += "<pre><code>" + esc(code.join("\n")) + "</code></pre>\n";
        continue;
      }
      if ((m = RE_HEAD.exec(s))) {
        var lv = m[1].length;
        out += "<h" + lv + ">" + inline(m[2] || "", ctx, depth) + "</h" + lv + ">\n";
        i++; continue;
      }
      if (RE_HR.test(s)) { out += "<hr>\n"; i++; continue; }
      if (RE_QUOTE.test(s)) {
        var q = [];
        while (i < L.length && RE_QUOTE.test(L[i].s)) {
          q.push({ s: L[i].s.replace(/^ {0,3}> ?/, ""), n: L[i].n }); i++;
        }
        out += "<blockquote>" + (depth < MAX_DEPTH ? blocks(q, ctx, depth + 1) : "<p>" + esc(q.map(function (x) { return x.s; }).join("\n")) + "</p>") + "</blockquote>\n";
        continue;
      }
      if (RE_ITEM.test(s)) { var lr = list(L, i, ctx, depth); out += lr.html; i = lr.end; continue; }
      if (isTableStart(L, i)) { var tr = table(L, i, ctx, depth); out += tr.html; i = tr.end; continue; }
      // paragraph
      var para = [L[i].s.replace(/^\s+/, "")];
      i++;
      while (i < L.length && !blank(L[i].s) && !startsBlock(L, i)) { para.push(L[i].s.replace(/^\s+/, "")); i++; }
      out += "<p>" + inline(para.join("\n").replace(/[ \t]+$/, ""), ctx, depth) + "</p>\n";
    }
    return out;
  }

  function table(L, i, ctx, depth) {
    var head = splitRow(L[i].s), al = splitRow(L[i + 1].s).map(function (c) {
      var l = c.charAt(0) === ":", r = c.charAt(c.length - 1) === ":";
      return l && r ? "c" : r ? "r" : l ? "l" : "";
    });
    function cell(tag, txt, k) {
      return "<" + tag + (al[k] ? ' class="al-' + al[k] + '"' : "") + ">" + inline(txt, ctx, depth + 1) + "</" + tag + ">";
    }
    var h = '<div class="md-table"><table><thead><tr>';
    head.forEach(function (c, k) { h += cell("th", c, k); });
    h += "</tr></thead><tbody>";
    i += 2;
    while (i < L.length && !blank(L[i].s) && L[i].s.indexOf("|") !== -1) {
      var row = splitRow(L[i].s);
      h += "<tr>";
      for (var k = 0; k < head.length; k++) h += cell("td", row[k] || "", k);
      h += "</tr>";
      i++;
    }
    return { html: h + "</tbody></table></div>\n", end: i };
  }

  // Lists, nested by indentation (2+ more spaces than the parent item).
  function list(L, i, ctx, depth) {
    var rootLists = [], stack = [];   // stack of { indent, ordered, start, items[] }
    function itemHost() { return stack.length ? stack[stack.length - 1] : null; }
    while (i < L.length) {
      var s = L[i].s, m = RE_ITEM.exec(s);
      if (blank(s)) {
        // a blank line continues the list only when more of it follows
        var j = i + 1;
        while (j < L.length && blank(L[j].s)) j++;
        if (j < L.length && (RE_ITEM.test(L[j].s) && !RE_HR.test(L[j].s)) && stack.length) { i = j; continue; }
        break;
      }
      if (m && !RE_HR.test(s)) {
        var ind = indentOf(m[1]), ordered = /\d/.test(m[2]);
        while (stack.length && ind < stack[stack.length - 1].indent - 1) stack.pop();
        var top = itemHost();
        if (top && ind >= top.indent + 2 && top.items.length) {
          var nl = { indent: ind, ordered: ordered, start: ordered ? parseInt(m[2], 10) : 1, items: [] };
          top.items[top.items.length - 1].sub.push(nl);
          stack.push(nl);
        } else if (!top || top.ordered !== ordered) {
          if (top) stack.pop();
          var parent = itemHost();
          var nl2 = { indent: ind, ordered: ordered, start: ordered ? parseInt(m[2], 10) : 1, items: [] };
          if (parent && parent.items.length) parent.items[parent.items.length - 1].sub.push(nl2);
          else rootLists.push(nl2);
          stack.push(nl2);
        }
        var host = itemHost();
        host.items.push({ lines: [m[3] || ""], n: L[i].n, sub: [] });
        i++; continue;
      }
      // continuation of the last item: indented, or a lazy line that starts nothing
      var last = itemHost();
      if (last && last.items.length && (/^[ \t]{2,}/.test(s) || !startsBlock(L, i))) {
        last.items[last.items.length - 1].lines.push(s.replace(/^\s+/, ""));
        i++; continue;
      }
      break;
    }
    function render(lst, d) {
      var tag = lst.ordered ? "ol" : "ul";
      var h = "<" + tag + (lst.ordered && lst.start !== 1 && isFinite(lst.start) ? ' start="' + lst.start + '"' : "") + ">";
      lst.items.forEach(function (it) {
        var first = it.lines[0], tm = RE_TASK.exec(first), body;
        if (tm) {
          var rest = [tm[2]].concat(it.lines.slice(1)).join("\n");
          h += '<li class="task"><input type="checkbox" data-line="' + it.n + '"' + (tm[1] === " " ? "" : " checked") + "> " +
               '<span class="task-text">' + inline(rest, ctx, depth + 1) + "</span>";
        } else {
          body = it.lines.join("\n");
          h += "<li>" + inline(body, ctx, depth + 1);
        }
        if (d < MAX_DEPTH) it.sub.forEach(function (sl) { h += render(sl, d + 1); });
        h += "</li>";
      });
      return h + "</" + tag + ">\n";
    }
    return { html: rootLists.map(function (l) { return render(l, 0); }).join(""), end: i };
  }

  function render(text, ctx) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var L = lines.map(function (s, n) { return { s: s, n: n }; });
    return blocks(L, ctx || {}, 0);
  }

  // ---------- 2. task checkbox in the text ----------
  var RE_TASK_LINE = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])/;
  function toggleTask(text, line) {
    var lines = String(text || "").split("\n");
    if (typeof line !== "number" || line < 0 || line >= lines.length) return null;
    var m = RE_TASK_LINE.exec(lines[line]);
    if (!m) return null;
    lines[line] = m[1] + (m[2] === " " ? "x" : " ") + m[3] + lines[line].slice(m[0].length);
    return lines.join("\n");
  }

  // ---------- 3. toolbar formatting ----------
  // → { text, a, b } (new text and selection)
  function lineRange(text, a, b) {
    var s = text.lastIndexOf("\n", a - 1) + 1;
    var e = text.indexOf("\n", b > a && text.charAt(b - 1) === "\n" ? b - 1 : b);
    if (e === -1) e = text.length;
    return { s: s, e: e };
  }
  function wrap(text, a, b, d) {
    var sel = text.slice(a, b);
    var L = d.length;
    if (a >= L && text.slice(a - L, a) === d && text.slice(b, b + L) === d &&
        !(L === 1 && text.charAt(a - 2) === d && text.charAt(b + 1) === d))
      return { text: text.slice(0, a - L) + sel + text.slice(b + L), a: a - L, b: b - L };
    if (sel.length >= 2 * L && sel.slice(0, L) === d && sel.slice(-L) === d)
      return { text: text.slice(0, a) + sel.slice(L, -L) + text.slice(b), a: a, b: b - 2 * L };
    // keep surrounding spaces outside the markers
    var lead = /^\s*/.exec(sel)[0], trail = /\s*$/.exec(sel.slice(lead.length))[0];
    var core = sel.slice(lead.length, sel.length - trail.length);
    var ins = lead + d + core + d + trail;
    var na = a + lead.length + L;
    return { text: text.slice(0, a) + ins + text.slice(b), a: na, b: na + core.length };
  }
  function mapLines(text, a, b, fn) {
    var r = lineRange(text, a, b);
    var block = text.slice(r.s, r.e).split("\n");
    var next = fn(block);
    var joined = next.join("\n");
    var out = text.slice(0, r.s) + joined + text.slice(r.e);
    if (a === b && block.length === 1) {
      var caret = Math.max(r.s, a + (joined.length - block[0].length));
      return { text: out, a: caret, b: caret };
    }
    return { text: out, a: r.s, b: r.s + joined.length };
  }
  var RE_BUL = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+/;
  var RE_TSK = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]?/;
  function format(text, a, b, kind) {
    text = String(text || "");
    a = Math.max(0, Math.min(a | 0, text.length));
    b = Math.max(a, Math.min(b | 0, text.length));
    var sel = text.slice(a, b);
    if (kind === "bold") return wrap(text, a, b, "**");
    if (kind === "italic") return wrap(text, a, b, "*");
    if (kind === "code") {
      if (sel.indexOf("\n") === -1) return wrap(text, a, b, "`");
      var pre = (a > 0 && text.charAt(a - 1) !== "\n") ? "\n" : "";
      var ins = pre + "```\n" + sel.replace(/\n$/, "") + "\n```\n";
      return { text: text.slice(0, a) + ins + text.slice(b), a: a + pre.length + 4, b: a + pre.length + 4 + sel.replace(/\n$/, "").length };
    }
    if (kind === "link") {
      var url = safeUrl(sel.trim()) ? sel.trim() : "";
      if (url) {
        var t1 = "[](" + url + ")";
        return { text: text.slice(0, a) + t1 + text.slice(b), a: a + 1, b: a + 1 };
      }
      var t2 = "[" + sel + "](https://)";
      if (!sel) return { text: text.slice(0, a) + t2 + text.slice(b), a: a + 1, b: a + 1 };
      return { text: text.slice(0, a) + t2 + text.slice(b), a: a + sel.length + 3, b: a + sel.length + 11 };
    }
    if (kind === "heading") {
      return mapLines(text, a, b, function (ls) {
        var m = /^(#{1,6})[ \t]+/.exec(ls[0]);
        var lvl = m ? m[1].length : 0;
        var next = lvl >= 3 ? 0 : lvl + 1;
        return ls.map(function (l) {
          var core = l.replace(/^#{1,6}[ \t]+/, "");
          return next ? new Array(next + 1).join("#") + " " + core : core;
        });
      });
    }
    if (kind === "list" || kind === "task") {
      return mapLines(text, a, b, function (ls) {
        var used = ls.filter(function (l, k) { return ls.length === 1 || !blank(l) || k === 0; });
        var allTask = used.every(function (l) { return RE_TSK.test(l); });
        var allBul = used.every(function (l) { return RE_BUL.test(l) && !RE_TSK.test(l); });
        return ls.map(function (l) {
          if (ls.length > 1 && blank(l)) return l;
          if (kind === "task") {
            if (allTask) return l.replace(RE_TSK, "$1");
            if (RE_TSK.test(l)) return l;
            if (RE_BUL.test(l)) return l.replace(RE_BUL, function (all, ws, mk) { return ws + mk + " [ ] "; });
            return l.replace(/^(\s*)/, "$1- [ ] ");
          }
          if (allBul) return l.replace(RE_BUL, "$1");
          if (RE_TSK.test(l)) return l.replace(RE_TSK, "$1- ");
          if (RE_BUL.test(l)) return l;
          return l.replace(/^(\s*)/, "$1- ");
        });
      });
    }
    return { text: text, a: a, b: b };
  }

  // ---------- 4. wiki links across notebooks ----------
  // RULE (help + Bible):
  //   [[Page]]           → a page titled Page in the SAME notebook
  //                        (first one in tree order if there are two);
  //                        else the ONE page titled Page in any other
  //                        notebook; two or more there → ambiguous;
  //                        none → missing (a click creates it here).
  //   [[Notebook/Page]]  → when the text before the first "/" names
  //                        exactly one notebook: the page titled Page
  //                        in it (missing → a click creates it there).
  //                        If no page is found that way, the whole text
  //                        is tried as a plain title (titles may hold "/").
  //   [[Target|label]]   → shows "label", links to Target.
  // Titles and notebook names ignore case and surrounding spaces.
  function key(s) { return String(s || "").trim().toLowerCase(); }
  function buildIndex(notebooks, pages) {
    var byTitle = {}, nbByName = {};
    (notebooks || []).forEach(function (n) {
      var k = key(n.name);
      if (!k) return;
      (nbByName[k] = nbByName[k] || []).push(n);
    });
    (pages || []).forEach(function (p) {
      var k = key(p.title);
      if (!k) return;
      (byTitle[k] = byTitle[k] || []).push(p);
    });
    return { byTitle: byTitle, nbByName: nbByName };
  }
  function resolve(target, fromNb, idx) {
    var raw = String(target || "").trim();
    var slash = raw.indexOf("/");
    if (slash > 0 && slash < raw.length - 1) {
      var nbs = idx.nbByName[key(raw.slice(0, slash))] || [];
      if (nbs.length === 1) {
        var nb = nbs[0], title = raw.slice(slash + 1).trim();
        var inNb = (idx.byTitle[key(title)] || []).filter(function (p) { return p.nb === nb.id; });
        if (inNb.length) return { page: inNb[0] };
        var plain = resolvePlain(raw, fromNb, idx);
        if (plain.page || plain.ambiguous) return plain;
        return { missing: true, nb: nb.id, title: title };
      }
    }
    return resolvePlain(raw, fromNb, idx);
  }
  function resolvePlain(title, fromNb, idx) {
    var all = idx.byTitle[key(title)] || [];
    var here = all.filter(function (p) { return p.nb === fromNb; });
    if (here.length) return { page: here[0] };
    if (all.length === 1) return { page: all[0] };
    if (all.length > 1) return { ambiguous: all };
    return { missing: true, nb: fromNb, title: String(title || "").trim() };
  }
  // [[…]] targets in a text (unique by lower case, in order)
  function wikiTargets(text) {
    var out = [], seen = {}, re = /\[\[([^\[\]\n]+)\]\]/g, m;
    while ((m = re.exec(String(text || ""))) !== null) {
      var tg = wikiParts(m[1]).target;
      if (tg && !seen[key(tg)]) { seen[key(tg)] = true; out.push(tg); }
    }
    return out;
  }

  // ---------- 5. templates ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fillTemplate(text, vars) {
    vars = vars || {};
    return String(text || "").replace(/\{\{\s*(date|time|title)\s*\}\}/gi, function (all, k) {
      var v = vars[k.toLowerCase()];
      return v === undefined || v === null ? all : String(v);
    });
  }

  // Markdown file of one page: "# Title", the text, the orOS line.
  function pageMarkdown(title, text) {
    var t = String(title || "").replace(/\s+/g, " ").trim();
    var body = String(text || "");
    return (t ? "# " + t + "\n\n" : "") + body.replace(/\s+$/, "") + "\n\n---\n\nMade with orOS | useoros.online\n";
  }

  var api = {
    esc: esc, safeUrl: safeUrl, render: render, inline: function (s, ctx) { return inline(String(s || ""), ctx || {}, 0); },
    toggleTask: toggleTask, format: format,
    buildIndex: buildIndex, resolve: resolve, wikiTargets: wikiTargets, wikiParts: wikiParts,
    ymd: ymd, hm: hm, fillTemplate: fillTemplate, pageMarkdown: pageMarkdown
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNotesMd = api;
})(this);
