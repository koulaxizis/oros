// ============================================================
// orOS Slides — mdimport.js: Markdown decks (v1.0.0)
// Pure (no DOM, no storage, no network). Reads a Markdown deck into
// the same neutral plan pptx.js read() makes, so OrosSlidesPPTX.build()
// turns it into a NEW deck (fresh ids, everything through core.js
// normalizers); nothing that exists is ever touched.
//
//   detect(text) → "marp" | "reveal" | "md"
//     marp    front matter "marp: true" (or a <!-- marp: true -->
//             comment at the top)
//     reveal  a reveal.js page (<section data-markdown> with a
//             <textarea data-template>), "--" vertical separators,
//             "Note:" speaker notes, or front matter with
//             revealOptions (reveal-md)
//     md      any other Markdown
//   parse(text, opts) → plan = { source, as, title, th, slides:[{ ly,
//     hid, tr, bg, n, items:[spec] }], media:{ key:true }, count:{
//     skipped, approx, unknown, slides, remote, local } } and
//     plan.get(key) → Promise<Uint8Array|null> for the pictures.
//     opts.name   the file name (the title when the deck has none)
//     opts.labels { pic: "Picture not imported:" } (speaker-note line
//                 for a picture that is a link)
//
// Slides: split at "---" (any thematic break: --- *** ___) outside
// code blocks; "--" (reveal.js vertical slides) is flattened into
// the same row; Marp headingDivider also splits at headings. Plain
// Markdown with no separators at all splits at its top headings.
// "Text\n---" and "Text\n===" are headings (setext), as in Markdown.
// On a slide: the first heading is the title; lists become bullets /
// numbering with their levels; other lines paragraphs (inline bold,
// italic, code, links as their text); pipe tables become a table;
// pictures become picture items: only pictures inside the file (data:
// URIs, PNG / JPEG / GIF / WebP) can come in, Slides does not load
// pictures from the web (offline, private), so a picture that is a
// link (https://…) or another file (img/a.png) is left out, counted,
// and its address written in the speaker notes. ![bg](…) is the
// slide background (Marp; "bg left" / "bg right" take that half);
// HTML comments are speaker notes (Marp) unless they are directives
// (_class, backgroundColor, paginate…); "Note:" starts the notes
// (reveal.js), as does <aside class="notes">. Other HTML is dropped
// (its text kept): nothing in the file is ever run or shown as HTML.
// Layouts: title, section, title and content, picture and text, full
// picture, chosen like the Outline view does.
// Exposes OrosSlidesMd on its global (browser or a Node vm) and
// module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  function C() { return root.OrosSlidesCore; }

  var MAX_TEXT = 5 * 1024 * 1024;          // characters read
  var MAX_IMG = 15 * 1024 * 1024;          // bytes of one inline picture
  var MAX_IMGS = 200;                      // inline pictures per deck

  // ---------- 1. Text helpers ----------
  var ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'", nbsp: "\u00a0", "#39": "'" };
  function unent(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      }
      var k = e.toLowerCase();
      return ENT[k] !== undefined ? ENT[k] : m;
    });
  }
  // HTML tags out (their text stays), entities decoded
  function noTags(s) { return unent(String(s).replace(/<\/?[a-z][^>]*>/gi, "")); }

  // Inline Markdown → runs [{ t, b?, i? }]: **bold**, __bold__, *it*,
  // _it_, `code`, ~~strike~~ (plain), [text](url) → text, <url>,
  // backslash escapes; pictures are taken out before.
  function inline(s) {
    s = noTags(s);
    var out = [], b = false, i = false, buf = "";
    function flush() {
      if (!buf) return;
      var last = out[out.length - 1];
      if (last && !!last.b === b && !!last.i === i) last.t += buf;
      else { var r = { t: buf }; if (b) r.b = true; if (i) r.i = true; out.push(r); }
      buf = "";
    }
    var k = 0, n = s.length;
    while (k < n) {
      var ch = s[k];
      if (ch === "\\" && k + 1 < n && /[\\`*_{}\[\]()#+\-.!|~<>]/.test(s[k + 1])) { buf += s[k + 1]; k += 2; continue; }
      if (ch === "`") {
        var e = s.indexOf("`", k + 1);
        if (e > k) { buf += s.slice(k + 1, e); k = e + 1; continue; }
      }
      if (ch === "[") {
        var m = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(s.slice(k));
        if (m) { buf += m[1] || m[2]; k += m[0].length; continue; }
      }
      if (ch === "~" && s[k + 1] === "~") { k += 2; continue; }
      if ((ch === "*" || ch === "_") && s[k + 1] === ch) {
        // a closing pair must exist for it to be bold
        if (b || s.indexOf(ch + ch, k + 2) > 0) { flush(); b = !b; k += 2; continue; }
      }
      if (ch === "*" || ch === "_") {
        var prev = k > 0 ? s[k - 1] : " ", next = s[k + 1] || " ";
        var wordInside = ch === "_" && /\w/.test(prev) && /\w/.test(next);
        if (!wordInside && (i ? !/\s/.test(prev) : (!/\s/.test(next) && s.indexOf(ch, k + 1) > 0))) { flush(); i = !i; k++; continue; }
      }
      buf += ch; k++;
    }
    flush();
    // collapse white space, none at the ends
    out.forEach(function (r) { r.t = r.t.replace(/[ \t]+/g, " "); });
    if (out.length) out[0].t = out[0].t.replace(/^ +/, "");
    if (out.length) out[out.length - 1].t = out[out.length - 1].t.replace(/ +$/, "");
    return out.filter(function (r) { return r.t; });
  }
  function runsText(r) { return r.map(function (x) { return x.t; }).join(""); }

  // ---------- 2. Front matter, source ----------
  function frontMatter(text) {
    var m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
    if (!m) return { fm: {}, body: text, had: false };
    var fm = {};
    m[1].split("\n").forEach(function (l) {
      var kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    });
    return { fm: fm, body: text.slice(m[0].length), had: true };
  }
  // reveal.js page: the Markdown of every <section data-markdown>
  function revealPage(text) {
    if (!/<section[^>]*data-markdown/i.test(text)) return null;
    var parts = [], re = /<section[^>]*data-markdown[^>]*>\s*<textarea[^>]*data-template[^>]*>([\s\S]*?)<\/textarea>/gi, m;
    while ((m = re.exec(text))) parts.push(unent(m[1]));
    return parts.length ? parts.join("\n\n---\n\n") : null;
  }
  function prep(text) {
    text = String(text == null ? "" : text).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    return text;
  }
  function detectIn(text) {
    var page = revealPage(text);
    if (page !== null) return { source: "reveal", md: page, fm: {} };
    var f = frontMatter(text);
    var marp = /^(true|yes|on)$/i.test(f.fm.marp || "") || /^\s*<!--\s*marp\s*:\s*true\s*-->/i.test(f.body);
    if (marp) return { source: "marp", md: f.body, fm: f.fm };
    var outside = f.body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
    if (f.fm.revealOptions !== undefined || /(^|\n)[ \t]*\n--[ \t]*\n[ \t]*\n/.test("\n" + outside + "\n") || /(^|\n)notes?:/i.test(outside)) {
      return { source: "reveal", md: f.body, fm: f.fm };
    }
    return { source: "md", md: f.body, fm: f.fm };
  }
  function detect(text) { return detectIn(prep(text)).source; }

  // ---------- 3. Splitting ----------
  var HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  var FENCE = /^ {0,3}(```|~~~)/;
  // a line that can be the text of a setext heading
  function paraLine(l) {
    return /\S/.test(l) && !/^ {0,3}(#|[-*+]\s|\d{1,3}[.)]\s|>|!\[|<|\||```|~~~)/.test(l) && !HR.test(l);
  }
  function split(md, source, divider) {
    var lines = md.split("\n"), slides = [[]], fence = "", any = false;
    var headings = [];
    lines.forEach(function (l, idx) {
      var cur = slides[slides.length - 1];
      var f = FENCE.exec(l);
      if (fence) { cur.push(l); if (f && f[1] === fence) fence = ""; return; }
      if (f) { fence = f[1]; cur.push(l); return; }
      var t = l.trim();
      if (source === "reveal" && t === "--") { slides.push([]); any = true; return; }
      if (HR.test(l)) {
        var prev = idx > 0 ? lines[idx - 1] : "";
        if (/^-/.test(t) && source !== "reveal" && paraLine(prev) && cur.length && cur[cur.length - 1] === prev) {
          cur[cur.length - 1] = "## " + prev.trim();          // setext heading
          return;
        }
        slides.push([]); any = true; return;
      }
      if (/^ {0,3}=+[ \t]*$/.test(l) && source !== "reveal" && idx > 0 && paraLine(lines[idx - 1]) && cur[cur.length - 1] === lines[idx - 1]) {
        cur[cur.length - 1] = "# " + lines[idx - 1].trim();   // setext heading
        headings.push(1);
        return;
      }
      var h = /^ {0,3}(#{1,6})\s/.exec(l);
      if (h) {
        headings.push(h[1].length);
        if (divider && h[1].length <= divider && cur.some(function (x) { return /\S/.test(x); })) { slides.push([l]); any = true; return; }
      }
      cur.push(l);
    });
    // plain Markdown without separators: one slide per top heading
    if (!any && source === "md" && headings.length > 1) {
      var top = Math.min.apply(null, headings);
      return split(md, source, top);
    }
    return slides.filter(function (s) { return s.some(function (x) { return /\S/.test(x); }); });
  }

  // ---------- 4. One slide ----------
  var DIRECTIVES = /^_?(theme|paginate|header|footer|class|backgroundColor|backgroundImage|backgroundPosition|backgroundRepeat|backgroundSize|color|headingDivider|size|style|math|title|description|author|image|marp|lang|transition|url|keywords)$/;
  var IMG = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  var NAMED = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", navy: "#000080",
    gray: "#808080", grey: "#808080", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", teal: "#008080" };
  function colour(v) {
    v = String(v || "").trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return NAMED[v] || null;
  }

  // lines → { title, body:[para], pics:[{ alt, src, bg, side }], tables:
  //   [rows], notes:[line], dir:{ key: value } }
  function readSlide(lines, source) {
    var S = { title: null, body: [], pics: [], tables: [], notes: [], dir: {}, code: 0 };
    var i = 0, n = lines.length, inNotes = false, para = null, stack = [];
    function endPara() { para = null; }
    function addPara(runs, ls, l) {
      var p = { l: l || 0, ls: ls || "", r: runs };
      S.body.push(p);
      return p;
    }
    function pics(l) {
      // pictures out of a line; what is left is its text
      return l.replace(IMG, function (m, alt, src) {
        var words = alt.trim().split(/\s+/), bg = words.indexOf("bg") >= 0;
        var side = bg && words.indexOf("left") >= 0 ? "left" : bg && words.indexOf("right") >= 0 ? "right" : "";
        var clean = words.filter(function (w) {
          return !/^(bg|left|right|contain|cover|fit|auto|vertical|\d+(\.\d+)?%|(w|h|width|height):\S+|(left|right):\S+|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia)(:\S+)?$/i.test(w);
        }).join(" ");
        S.pics.push({ alt: clean, src: src, bg: bg, side: side });
        return " ";
      });
    }
    while (i < n) {
      var l = lines[i];
      // HTML comments (several lines too): directives or notes
      var cm = /^\s*<!--([\s\S]*)$/.exec(l);
      if (cm) {
        var body = cm[1], j = i;
        while (body.indexOf("-->") < 0 && j + 1 < n) { j++; body += "\n" + lines[j]; }
        var end = body.indexOf("-->");
        var inner = end >= 0 ? body.slice(0, end) : body;
        var rest = end >= 0 ? body.slice(end + 3) : "";
        var rows = inner.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
        var dirs = rows.map(function (x) { return /^([\w-]+)\s*:\s*(.*)$/.exec(x); });
        if (rows.length && dirs.every(function (d) { return d && DIRECTIVES.test(d[1]); })) {
          dirs.forEach(function (d) { S.dir[d[1]] = d[2].trim(); });
        } else if (rows.length) S.notes.push(inner.trim());
        i = j + 1;
        if (rest.trim()) { lines.splice(i, 0, rest); n = lines.length; }
        endPara();
        continue;
      }
      if (inNotes) { S.notes.push(noTags(l)); i++; continue; }
      var asideM = /^\s*<aside[^>]*class=["'][^"']*notes[^"']*["'][^>]*>([\s\S]*)$/i.exec(l);
      if (asideM) {
        var ab = asideM[1], k2 = i;
        while (!/<\/aside>/i.test(ab) && k2 + 1 < n) { k2++; ab += "\n" + lines[k2]; }
        S.notes.push(noTags(ab.replace(/<\/aside>[\s\S]*$/i, "")).trim());
        i = k2 + 1; endPara(); continue;
      }
      var nm = /^\s*notes?:\s?(.*)$/i.exec(l);
      if (nm && (source === "reveal" || source === "md")) { inNotes = true; if (nm[1].trim()) S.notes.push(nm[1]); i++; continue; }
      // fenced code: its lines as plain paragraphs
      var f = FENCE.exec(l);
      if (f) {
        var j2 = i + 1;
        while (j2 < n && !(FENCE.exec(lines[j2]) && FENCE.exec(lines[j2])[1] === f[1])) {
          var code = lines[j2].replace(/\t/g, "    ");
          addPara(code.trim() ? [{ t: code.replace(/ /g, "\u00a0") }] : [], "", 0);
          S.code++;
          j2++;
        }
        i = j2 + 1; endPara(); stack = []; continue;
      }
      // a pipe table: header row + delimiter row
      if (/\|/.test(l) && i + 1 < n && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
        var rowsT = [], j3 = i;
        var cells = function (x) {
          return x.trim().replace(/\\\|/g, "\u0000").replace(/^\||\|$/g, "").split("|").map(function (c) {
            return runsText(inline(c.trim().replace(/\u0000/g, "|")));
          });
        };
        rowsT.push(cells(lines[i]));
        j3 = i + 2;
        while (j3 < n && /\|/.test(lines[j3]) && lines[j3].trim()) { rowsT.push(cells(lines[j3])); j3++; }
        S.tables.push(rowsT);
        i = j3; endPara(); stack = []; continue;
      }
      var text = pics(l);
      var t = text.trim();
      if (!t) { i++; if (!/\S/.test(l)) { endPara(); } continue; }
      var h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text);
      if (h) {
        var hr = inline(h[2]);
        if (S.title === null) S.title = hr;
        else addPara(hr.map(function (r) { return { t: r.t, b: true, i: r.i }; }), "", 0);
        i++; endPara(); stack = []; continue;
      }
      var li = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(text);
      if (li) {
        var ind = li[1].replace(/\t/g, "    ").length;
        while (stack.length && ind < stack[stack.length - 1]) stack.pop();
        if (!stack.length || ind > stack[stack.length - 1]) stack.push(ind);
        var task = /^\[( |x|X)\]\s+(.*)$/.exec(li[3]);
        para = addPara(inline(task ? (task[1] === " " ? "\u2610 " : "\u2611 ") + task[2] : li[3]), /\d/.test(li[2]) ? "n" : "b", Math.min(4, stack.length - 1));
        i++; continue;
      }
      var q = /^\s*>\s?(.*)$/.exec(text);
      if (q) { addPara(inline(q[1]), "", 0); i++; endPara(); continue; }
      // a continuation line: Markdown joins it to the paragraph (Marp
      // keeps the line break)
      if (para && source !== "marp" && !/^\s{0,3}$/.test(lines[i - 1] || "")) {
        var more = inline(t);
        if (more.length) { para.r.push({ t: " " }); para.r = para.r.concat(more); }
        i++; continue;
      }
      stack = [];
      para = addPara(inline(t), "", 0);
      i++;
    }
    // whole runs only
    S.body.forEach(function (p) {
      var rs = [];
      p.r.forEach(function (r) {
        var last = rs[rs.length - 1];
        if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.t += r.t; else rs.push(r);
      });
      p.r = rs.filter(function (r) { return r.t; });
    });
    return S;
  }

  // ---------- 5. Plan ----------
  function phOf(lyId, role, as) {
    var ly = C().layoutById(lyId), hit = null;
    if (ly) ly.ph.forEach(function (p) { if (p.role === role) hit = p; });
    return hit ? C().phBox(hit, as) : null;
  }
  function b64bytes(s) {
    if (typeof root.atob === "function") {
      var bin = root.atob(s), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(s, "base64"));
  }

  function parse(text, opts) {
    opts = opts || {};
    var labels = { pic: (opts.labels && opts.labels.pic) || "Picture not imported:" };
    var d = detectIn(prep(text));
    var fm = d.fm, Co = C();
    var plan = { source: d.source, as: "16:9", title: "", th: "light", slides: [], media: {},
      count: { skipped: 0, approx: 0, unknown: 0, slides: 0, remote: 0, local: 0 } };
    if (/^4:3$/.test(fm.size || "")) plan.as = "4:3";
    var W = Co.widthOf(plan.as), H = Co.H;
    var data = [];
    var glob = { bg: colour(fm.backgroundColor), cls: fm["class"] || "" };
    var divider = Math.max(0, Math.min(6, parseInt(fm.headingDivider, 10) || 0));
    var raw = split(d.md, d.source, divider);
    plan.count.slides = raw.length;
    var firstTitle = "";
    raw.slice(0, Co.LIM.slides).forEach(function (lines, idx) {
      var S = readSlide(lines.slice(), d.source);
      // Marp directives: without "_" from this slide on, with "_" this slide only
      if (S.dir.backgroundColor !== undefined) glob.bg = colour(S.dir.backgroundColor);
      if (S.dir["class"] !== undefined) glob.cls = S.dir["class"];
      var bg = S.dir._backgroundColor !== undefined ? colour(S.dir._backgroundColor) : glob.bg;
      var cls = S.dir._class !== undefined ? S.dir._class : glob.cls;
      if (idx === 0 && (/\binvert\b/.test(cls) || (bg && lumOf(bg) < 0.35))) plan.th = "dark";
      var P = { ly: "content", hid: false, tr: "none", bg: bg || null, n: "", items: [] };
      var notes = S.notes.slice();
      // pictures: inside the file (data:) come in, links are noted
      var bgPic = null, pics = [];
      S.pics.forEach(function (p) {
        var m = /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+\/=\s]+)$/i.exec(p.src);
        if (m && data.length < MAX_IMGS && m[2].length <= MAX_IMG * 4 / 3) {
          var key = "md:" + data.length;
          data.push(m[2].replace(/\s+/g, ""));
          plan.media[key] = true;
          var o = { key: key, alt: p.alt, side: p.side };
          if (p.bg && !p.side) { if (!bgPic) bgPic = o; else plan.count.skipped++; }
          else pics.push(o);
          return;
        }
        if (/^https?:\/\//i.test(p.src)) plan.count.remote++;
        else if (p.src && !/^data:/i.test(p.src)) plan.count.local++;
        else plan.count.skipped++;
        if (p.src && !/^data:/i.test(p.src)) notes.push(labels.pic + " " + (p.alt ? p.alt + " " : "") + p.src.slice(0, 500));
      });
      if (bgPic) P.items.push({ k: "image", x: 0, y: 0, w: W, h: H, r: 0, media: bgPic.key, crop: null, lk: true });
      var title = S.title ? S.title : null;
      if (title && !firstTitle) firstTitle = runsText(title);
      var body = S.body, plainOnly = body.every(function (p) { return !p.ls && !p.l; }) && !S.code;
      var hasBody = body.some(function (p) { return p.r.length; });
      var tables = S.tables;
      var pic = pics.length ? pics[0] : null;
      if (pics.length > 1) plan.count.skipped += pics.length - 1;
      if (pic && hasBody) P.ly = "imgtext";
      else if (pic && !title) P.ly = "photo";
      else if (pic) P.ly = "imgtext";
      else if (!hasBody && !tables.length) P.ly = idx === 0 ? "title" : "section";
      else if (idx === 0 && plainOnly && body.length <= 2 && !tables.length) P.ly = "title";
      else P.ly = "content";
      var as = plan.as;
      var bodyRole = P.ly === "title" || P.ly === "section" ? "sub" : P.ly === "photo" ? "cap" : "body";
      if (title) {
        var tb = phOf(P.ly, "title", as) || phOf(P.ly, "cap", as);
        var trole = phOf(P.ly, "title", as) ? "title" : "cap";
        if (tb) P.items.push({ k: "text", x: tb.x, y: tb.y, w: tb.w, h: tb.h, r: 0, ph: trole,
          paras: [{ l: 0, ls: "", r: title.map(function (r) { var o = { t: r.t }; if (r.i && trole !== "title") o.i = true; return o; }) }], fit: true });
      }
      if (hasBody) {
        var bb = phOf(P.ly, bodyRole, as);
        if (pic && pic.side === "right" && P.ly === "imgtext") bb.x = W - bb.x - bb.w;
        var it = { k: "text", x: bb.x, y: bb.y, w: bb.w, h: bb.h, r: 0, ph: bodyRole, paras: body, fit: true };
        if (S.code && S.code >= body.length) it.ff = "mono";
        P.items.push(it);
        var chars = 0;
        body.forEach(function (p) { chars += runsText(p.r).length; });
        if (body.length > Co.LIM.paras || chars > Co.LIM.itemText) plan.count.approx++;
      }
      if (pic) {
        var ib = phOf(P.ly, "img", as);
        if (pic.side === "right" && P.ly === "imgtext") ib.x = W - ib.x - ib.w;
        var im = { k: "image", x: ib.x, y: ib.y, w: ib.w, h: ib.h, r: 0, ph: "img", media: pic.key, crop: null };
        if (pic.alt) im.alt = pic.alt;
        P.items.push(im);
      }
      // tables: in the body's place (under its text when there is some)
      tables.forEach(function (rows, ti) {
        var box = phOf(P.ly, "body", as) || phOf("content", "body", as);
        if (pic && pic.side === "right" && P.ly === "imgtext") box.x = W - box.x - box.w;
        var y = hasBody ? Math.round(box.y + box.h / 2) : box.y, h = hasBody ? Math.round(box.h / 2) : box.h;
        if (ti > 0) { plan.count.skipped++; return; }
        P.items.push({ k: "table", x: box.x, y: y, w: box.w, h: h, r: 0, tb: { rows: rows, hd: true } });
      });
      // a table without text: the layout's empty body goes (tidy)
      if (tables.length && !hasBody) P.noBody = true;
      P.n = Co.cleanBlock(notes.join("\n").replace(/\u00a0/g, " "), Co.LIM.notes);
      plan.slides.push(P);
    });
    if (raw.length > Co.LIM.slides) plan.count.skipped += raw.length - Co.LIM.slides;
    plan.title = Co.cleanLine(fm.title || firstTitle || String(opts.name || "").replace(/\.(md|markdown|mdown|txt|html?)$/i, ""), Co.LIM.title);
    if (Co.THEME_IDS.indexOf(fm.theme) >= 0) plan.th = fm.theme;
    plan.get = function (key) {
      var m = /^md:(\d+)$/.exec(key), s = m ? data[+m[1]] : null;
      if (!s) return Promise.resolve(null);
      try { return Promise.resolve(b64bytes(s)); } catch (e) { return Promise.resolve(null); }
    };
    return plan;
  }
  function lumOf(h) {
    var v = [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  // A text file that looks like a Markdown deck (for "Open file")
  function looks(text) {
    var d = detectIn(prep(String(text || "").slice(0, 200000)));
    if (d.source !== "md") return true;
    return /(^|\n)#{1,6}\s|(^|\n)\s*[-*+]\s|(^|\n)-{3,}\s*(\n|$)/.test(d.md);
  }

  // After OrosSlidesPPTX.build(plan, …): the empty body placeholder of
  // a slide whose body is a table (build adds every placeholder of the
  // layout) is left out, so it does not sit under the table.
  function tidy(plan, built) {
    var drop = {};
    built.slides.forEach(function (s, i) { if (plan.slides[i] && plan.slides[i].noBody) drop[s.id] = 1; });
    built.items = built.items.filter(function (it) {
      return !(drop[it.s] && it.ph === "body" && it.k === "text" && !it.paras.length);
    });
    return built;
  }

  var API = { detect: detect, parse: parse, tidy: tidy, looks: looks, inline: inline, MAX_TEXT: MAX_TEXT };
  root.OrosSlidesMd = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
