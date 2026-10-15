// ============================================================
// orOS Library — import.js (pure logic: "Import highlights")
// Reads highlights the person exported from another reader, as DATA
// only (nothing is run, nothing becomes HTML):
//   - Kindle    "My Clippings.txt" (documents/ folder of the Kindle):
//               entries split by "==========": "Title (Author)", a
//               meta line "- Your Highlight on page 12 | Location
//               123-125 | Added on …" (localized: tolerant), blank, text.
//               Notes join the highlight they end on; bookmarks too.
//   - KOReader  Export highlights › JSON: one document { title,
//               author, entries|annotations: [{ chapter, text, note,
//               time|datetime, page|pageno, sort, color }] } or many
//               ({ documents: [...] } / an array); and the Markdown
//               export ("# Title", "##### Author", "## Chapter",
//               "### Page 12 @ date", text, "---", note)
//   - Readwise  Export › CSV: Highlight, Book Title, Book Author,
//               Amazon Book ID, Note, Color, Tags, Location Type,
//               Location, Highlighted at, Document tags
//   parseText(text, name) → { source, books: [{ title, author,
//                             items: [{ t: "hl"|"note"|"bm", text, note,
//                             page, sec, chapter, date, c }] }] }
//                           or { error: "bad"|"empty"|"big" }
//   readBytes(bytes, name)→ Promise of the same
//   matchBook(src, books) → the Library book (core.js record) whose
//                           title (and author, when both have one)
//                           match after folding, or null
//   locate(texts, quote, hint) → { s, a, b } where the quote is in the
//                           book's text (EPUB: chapter texts, PDF: page
//                           texts; offsets as the reader counts them)
//   planBook(src, book, ctx) → the marks to add to that book, with
//                           counts (located, page bookmarks, already
//                           there, without a place)
// Library's highlights need a place in the text ("e:<chapter>:<offset>"
// / "p:<page>:<offset>", core.js section 4), so each quote is looked
// for in the book's own text: exactly (accents, case, quotes, dashes
// and spaces folded), then letters and digits only, then by its first
// and last words. A PDF highlight that can't be found but has a page
// becomes a bookmark of that page carrying the quote and the note;
// anything else without a place is counted as skipped.
// Stable mark ids ("ki" + hash of book + kind + text): importing the
// same file twice adds nothing. (Mark ids must match core.js
// MARK_ID_RE /^k[0-9a-z]{6,24}$/, so no "imp-" prefix here.)
// Caps: file size, books, entries, text / note length.
// Needs OrosImportKit (../importkit.js) and LibCore (core.js).
// UMD: window.OrosLibraryImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;
  var C = NODE ? require("./core.js") : root.LibCore;

  var MAX_FILE = 30 * 1024 * 1024;
  var MAX_TEXT = 30 * 1024 * 1024;
  var MAX_BOOKS = 2000;
  var MAX_ITEMS = 20000;
  var MAX_DEPTH = 8;
  var TEXT_LEN = 4000;
  var NOTE_LEN = 4000;
  var LBL_LEN = 120;

  // ---------- 1. Small helpers ----------
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
  }
  function pad7(h) { return (h + "0000000").slice(0, 7); }
  function markId(bookId, kind, key) {
    var s = bookId + "|" + kind + "|" + key;
    return "ki" + pad7(K.hash(s)) + pad7(K.hash("#" + s));
  }
  function int(v) {
    var n = typeof v === "number" ? v : parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10);
    return isFinite(n) && n > 0 && n < 1e7 ? Math.floor(n) : 0;
  }
  // the colours of the source → Library's four (yellow, green, blue, pink)
  function colorOf(v) {
    var s = fold(v);
    if (/green|πρασιν/.test(s)) return 1;
    if (/blue|cyan|μπλε|γαλαζ/.test(s)) return 2;
    if (/pink|red|purple|orange|magenta|ροζ|κοκκιν|μωβ|πορτοκαλ/.test(s)) return 3;
    return 0;
  }
  function dateOf(v) {
    if (v === null || v === undefined || v === "") return 0;
    var t = K.parseDate(typeof v === "number" ? v : K.clean(v, 80));
    return isFinite(t) && t > 0 ? t : 0;
  }
  // "Added on Monday, 1 January 2024 12:00:00" → the date, whatever
  // the words before it (localized Kindles): shorter and shorter tails
  function looseDate(s) {
    var w = K.clean(s, 120).split(" ");
    for (var i = 0; i < w.length && i < 8; i++) {
      var t = dateOf(w.slice(i).join(" "));
      if (t) return t;
    }
    return 0;
  }

  // ---------- 2. Collecting ----------
  function collector(source) {
    var books = [], byKey = {}, n = 0;
    return {
      book: function (title, author) {
        title = K.clean(title, C.TITLE_LEN);
        author = K.clean(author, C.BY_LEN);
        if (!title) return null;
        var key = fold(title) + "\u0001" + fold(author);
        if (byKey[key]) return byKey[key];
        if (books.length >= MAX_BOOKS) return null;
        var b = { title: title, author: author, items: [] };
        books.push(b);
        byKey[key] = b;
        return b;
      },
      item: function (b, it) {
        if (!b || n >= MAX_ITEMS) return;
        var o = { t: it.t };
        var text = K.cleanText(it.text, TEXT_LEN), note = K.cleanText(it.note, NOTE_LEN);
        if (text) o.text = text;
        if (note) o.note = note;
        if (o.t === "hl" && !text) { if (!note) return; o.t = "note"; }
        if (o.t === "note" && !note) { if (!text) return; o.note = text; delete o.text; }
        var page = int(it.page); if (page) o.page = page;
        if (typeof it.sec === "number" && it.sec >= 0) o.sec = it.sec;
        if (it.lo) o.lo = it.lo;
        if (it.hi) o.hi = it.hi;
        var ch = K.clean(it.chapter, LBL_LEN); if (ch) o.chapter = ch;
        if (it.date) o.date = it.date;
        if (it.c) o.c = it.c;
        b.items.push(o);
        n++;
      },
      done: function () {
        var out = books.filter(function (b) { return b.items.length; });
        if (!out.length) return { error: "empty", source: source };
        return { source: source, books: out };
      }
    };
  }

  // ---------- 3. Kindle "My Clippings.txt" ----------
  var KB_BM = /bookmark|lesezeichen|signet|marque-page|marcador|segnalibro|bladwijzer|закладк|ブックマーク|书签|書籤/i;
  var KB_HL = /highlight|markierung|surlign|subrayado|evidenziazion|destaque|markering|выделени|ハイライト|标注|標註|υπογράμμ/i;
  var KB_NOTE = /\bnote\b|notiz|\bnota\b|notitie|заметк|メモ|笔记|筆記|σημείωσ/i;
  var KB_PAGE = /(?:page|seite|página|pagina|pág\.?|bladzijde|страниц[аеыу]|σελίδα)\s*(\d+)/i;
  var KB_LOC = /(?:location|loc\.|emplacement|position|posición|posizione|posição|locatie|позици[яи]|位置|θέση)\s*(\d+)(?:\s*-\s*(\d+))?/i;
  function parseKindle(text) {
    var c = collector("kindle");
    var chunks = text.replace(/\r\n?/g, "\n").split(/\n?={5,}[ \t]*(?:\n|$)/);
    var notes = [];
    chunks.forEach(function (ch) {
      var lines = ch.replace(/^﻿/, "").replace(/^\s*\n/, "").split("\n");
      while (lines.length && !lines[0].trim()) lines.shift();
      if (lines.length < 2) return;
      var head = lines[0].replace(/^﻿/, "").trim(), meta = lines[1].trim();
      if (meta.charAt(0) !== "-") return;
      var body = lines.slice(2).join("\n").trim();
      if (/^<.*clipping limit.*>$/i.test(body) || /^<.*>$/.test(body) && body.length < 120) body = "";
      var m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(head);
      var b = c.book(m && m[1] ? m[1] : head, m ? m[2] : "");
      if (!b) return;
      var parts = meta.split("|");
      var lm = KB_LOC.exec(meta), pm = KB_PAGE.exec(meta);
      var kind = KB_BM.test(parts[0]) ? "bm" : KB_HL.test(parts[0]) ? "hl" : KB_NOTE.test(parts[0]) ? "note" : (body ? "hl" : "bm");
      var it = {
        t: kind, page: pm ? pm[1] : "", lo: lm ? +lm[1] : 0, hi: lm ? +(lm[2] || lm[1]) : 0,
        date: parts.length > 1 ? looseDate(parts[parts.length - 1]) : 0
      };
      if (kind === "note") { it.note = body; notes.push({ b: b, it: it }); return; }
      if (kind === "hl") {
        if (!body) return;
        it.text = body;
        // an edited highlight is exported again: keep the newest text once
        for (var i = b.items.length - 1; i >= 0; i--) {
          var x = b.items[i];
          if (x.t === "hl" && x.text === K.cleanText(body, TEXT_LEN)) { b.items.splice(i, 1); break; }
        }
      }
      c.item(b, it);
    });
    // a note joins the highlight it ends on (Kindle gives the note the
    // highlight's last location), else the one around it
    notes.forEach(function (n) {
      var L = n.it.hi || n.it.lo, best = null;
      if (L) {
        n.b.items.forEach(function (x) {
          if (x.t !== "hl" || !x.lo) return;
          if (x.hi === L && (!best || best.hi !== L)) best = x;
          else if (!best && x.lo <= L && L <= x.hi) best = x;
        });
      }
      var note = K.cleanText(n.it.note, NOTE_LEN);
      if (best) best.note = best.note ? (best.note + "\n\n" + note).slice(0, NOTE_LEN) : note;
      else c.item(n.b, n.it);
    });
    return c.done();
  }

  // ---------- 4. KOReader ----------
  var DOC_LISTS = ["entries", "annotations", "highlights", "bookmarks"];
  function koEntry(c, b, e) {
    if (!e || typeof e !== "object") return;
    var text = typeof e.text === "string" ? e.text : (typeof e.highlight === "string" ? e.highlight : "");
    var note = typeof e.note === "string" ? e.note : (typeof e.notes === "string" && text ? e.notes : "");
    var sort = String(e.sort || e.type || "").toLowerCase();
    var page = e.pageno !== undefined ? e.pageno : e.page;
    var sec = -1;
    // EPUB: KOReader's xpointer names the chapter file of the spine
    var xp = typeof e.page === "string" ? e.page : (typeof e.pos0 === "string" ? e.pos0 : "");
    var dm = /DocFragment\[(\d+)\]/.exec(xp);
    if (dm) sec = +dm[1] - 1;
    if (typeof page === "string" && !/^\s*\d+\s*$/.test(page)) page = e.pageno !== undefined ? e.pageno : "";
    var t = sort === "bookmark" || (!text && !note) ? "bm" : (text ? "hl" : "note");
    c.item(b, {
      t: t, text: text, note: note, page: page, sec: sec, chapter: e.chapter,
      date: dateOf(e.time !== undefined ? e.time : (e.datetime !== undefined ? e.datetime : e.date)),
      c: e.color ? colorOf(e.color) : 0
    });
  }
  function parseKoJson(obj) {
    var c = collector("koreader"), found = 0;
    (function walk(x, depth) {
      if (!x || typeof x !== "object" || depth > MAX_DEPTH) return;
      if (Array.isArray(x)) { x.forEach(function (y) { walk(y, depth + 1); }); return; }
      var list = null;
      for (var i = 0; i < DOC_LISTS.length; i++) if (Array.isArray(x[DOC_LISTS[i]])) { list = x[DOC_LISTS[i]]; break; }
      if (list && (typeof x.title === "string" || typeof x.file === "string")) {
        found++;
        var title = typeof x.title === "string" && x.title.trim() ? x.title :
          String(x.file || "").split("/").pop().replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ");
        var author = typeof x.author === "string" ? x.author.replace(/\s*\n\s*/g, ", ") :
          (typeof x.authors === "string" ? x.authors.replace(/\s*\n\s*/g, ", ") : "");
        var b = c.book(title, author);
        list.forEach(function (e) { koEntry(c, b, e); });
        return;
      }
      Object.keys(x).forEach(function (k) { if (x[k] && typeof x[k] === "object") walk(x[k], depth + 1); });
    })(obj, 0);
    if (!found) return { error: "bad" };
    return c.done();
  }
  // KOReader's highlight styles in Markdown: ==text==, <u>text</u>,
  // ~~text~~, **text**
  function unstyle(s) {
    return String(s).replace(/^==([\s\S]*)==$/, "$1").replace(/^<u>([\s\S]*)<\/u>$/i, "$1")
      .replace(/^~~([\s\S]*)~~$/, "$1").replace(/^\*\*([\s\S]*)\*\*$/, "$1").replace(/^_([\s\S]*)_$/, "$1");
  }
  function parseKoMd(text) {
    var c = collector("koreader-md");
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    var b = null, title = "", author = "", chapter = "", cur = null, afterTitle = false;
    function flush() {
      if (!cur) return;
      var parts = cur.lines.join("\n").split(/\n-{3,}\n/);
      var hl = unstyle(parts[0].trim()), note = parts.slice(1).join("\n").trim();
      if (!b) b = c.book(title, author);
      c.item(b, { t: hl ? "hl" : "note", text: hl, note: note, page: cur.page, chapter: chapter, date: cur.date });
      cur = null;
    }
    lines.forEach(function (ln) {
      var m;
      if ((m = /^#\s+(.+)$/.exec(ln))) { flush(); title = m[1]; author = ""; chapter = ""; b = null; afterTitle = true; return; }
      if ((m = /^#####\s+(.*)$/.exec(ln)) && afterTitle) {
        author = /^n\/?a$/i.test(m[1].trim()) ? "" : m[1];
        afterTitle = false;
        return;
      }
      if ((m = /^##\s+(.*)$/.exec(ln))) { flush(); chapter = m[1]; afterTitle = false; return; }
      if ((m = /^###\s+(.*)$/.exec(ln))) {
        flush();
        afterTitle = false;
        var at = m[1].split("@");
        var pg = /(\d+)/.exec(at[0]);
        cur = { page: pg ? pg[1] : "", date: at.length > 1 ? looseDate(at.slice(1).join("@")) : 0, lines: [] };
        return;
      }
      if (/^_(generated|δημιουργ)/i.test(ln.trim())) { flush(); return; }
      if (cur) cur.lines.push(ln);
    });
    flush();
    return c.done();
  }

  // ---------- 5. Readwise CSV ----------
  function parseReadwise(recs) {
    var c = collector("readwise");
    recs.rows.forEach(function (r) {
      var b = c.book(K.get(r, ["Book Title", "Title"]), K.get(r, ["Book Author", "Author"]));
      if (!b) return;
      var lt = fold(K.get(r, ["Location Type"])), loc = K.get(r, ["Location"]);
      c.item(b, {
        t: "hl",
        text: K.get(r, ["Highlight", "Text"]),
        note: K.get(r, ["Note", "Notes"]),
        page: lt === "page" ? loc : "",
        date: dateOf(K.get(r, ["Highlighted at", "Highlighted At", "Date"])),
        c: colorOf(K.get(r, ["Color", "Colour"]))
      });
    });
    return c.done();
  }

  // ---------- 6. Detect + read ----------
  function parseText(text, name) {
    text = String(text == null ? "" : text);
    if (text.length > MAX_TEXT) return { error: "big" };
    var t0 = text.replace(/^﻿/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    if (t0.charAt(0) === "{" || t0.charAt(0) === "[") {
      var obj = K.json(t0);
      return obj === null ? { error: "bad" } : parseKoJson(obj);
    }
    if (/^={5,}\s*$/m.test(t0) && /^-\s.*\|/m.test(t0)) return parseKindle(t0);
    if (/^#\s+\S/.test(t0) && /^###\s+.*\d/m.test(t0)) return parseKoMd(t0);
    var recs = K.records(t0, { maxRows: MAX_ITEMS });
    if (K.col(recs.head, ["Highlight"]) !== -1 && K.col(recs.head, ["Book Title", "Title"]) !== -1) return parseReadwise(recs);
    return { error: "bad" };
  }
  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    var txt;
    try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    return Promise.resolve(parseText(txt, name));
  }

  // ---------- 7. Matching a book of the Library ----------
  var STOP = { the: 1, and: 1, von: 1, van: 1, der: 1, και: 1 };
  function normTitle(s) {
    return fold(s).replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^a-z0-9Ͱ-ϿЀ-ӿ]+/g, " ").trim();
  }
  function mainTitle(s) {
    var t = String(s || "").split(/\s*[:–—]\s*|\s+-\s+/)[0];
    return normTitle(t);
  }
  function authorWords(s) {
    var out = {};
    fold(s).replace(/[^a-z0-9Ͱ-ϿЀ-ӿ]+/g, " ").split(" ").forEach(function (w) {
      if (w.length >= 3 && !STOP[w]) out[w] = 1;
    });
    return out;
  }
  function matchBook(src, books) {
    var nt = normTitle(src.title), mt = mainTitle(src.title), aw = authorWords(src.author);
    var hasA = Object.keys(aw).length > 0;
    var best = null, bestScore = 0;
    (books || []).forEach(function (b) {
      if (!b || !b.id) return;
      var bt = normTitle(b.title), score = 0;
      if (!bt) return;
      if (bt === nt) score = 3;
      else if (mainTitle(b.title) === mt && mt.length >= 3) score = 2;
      else if (mt.length >= 3 && (bt === mt || mainTitle(b.title) === nt)) score = 2;
      if (!score) return;
      var bw = authorWords(b.by);
      if (hasA && Object.keys(bw).length) {
        if (!Object.keys(aw).some(function (w) { return bw[w]; })) return;   // another author's book
        score += 2;
      }
      if (score > bestScore || (score === bestScore && best && b.id < best.id)) { best = b; bestScore = score; }
    });
    return best;
  }

  // ---------- 8. Finding a quote in the book's text ----------
  var PUNCT = { "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'", "´": "'",
                "“": "\"", "”": "\"", "„": "\"", "‟": "\"", "″": "\"", "«": "\"", "»": "\"",
                "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
                "…": "...", " ": " " };
  var ALNUM = /[0-9a-zµß-ÿĀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ֐-ۿ぀-ヿ一-鿿가-힯]/;
  // folded text with a map back: f[i] came from text[map[i]];
  // loose keeps letters and digits only
  function normMap(text, loose) {
    text = String(text || "");
    var f = "", map = [], sp = true;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i), code = text.charCodeAt(i);
      if (code === 0xad || (code >= 0x200b && code <= 0x200d) || code === 0xfeff) continue;
      if (code >= 0xd800 && code <= 0xdbff) {                // keep surrogate pairs whole
        if (!loose) { f += text.substr(i, 2); map.push(i, i); sp = false; }
        i++;
        continue;
      }
      var g = PUNCT[ch] !== undefined ? PUNCT[ch] : fold(ch);
      for (var j = 0; j < g.length; j++) {
        var x = g.charAt(j);
        if (/\s/.test(x)) {
          if (loose || sp) continue;
          f += " "; map.push(i); sp = true;
          continue;
        }
        if (loose && !ALNUM.test(x)) continue;
        f += x; map.push(i); sp = false;
      }
    }
    return { f: f, map: map };
  }
  function qnorm(q, loose) { return normMap(q, loose).f.trim(); }
  // source range [a, b) of the folded match f[i, i + n)
  function range(text, nm, i, n) {
    var a = nm.map[i], last = nm.map[i + n - 1];
    var b = last + ((text.charCodeAt(last) >= 0xd800 && text.charCodeAt(last) <= 0xdbff) ? 2 : 1);
    return { a: a, b: b };
  }
  // texts: [string] (EPUB chapters / PDF pages); hint: a section to try
  // first (PDF page − 1, KOReader's chapter); cache: reused maps
  function locate(texts, quote, hint, cache) {
    if (!texts || !texts.length) return null;
    cache = cache || {};
    var order = [];
    if (typeof hint === "number" && hint >= 0 && hint < texts.length) order.push(hint);
    for (var s = 0; s < texts.length; s++) if (s !== hint) order.push(s);
    function nmOf(si, loose) {
      var k = (loose ? "l" : "s") + si;
      if (!cache[k]) cache[k] = normMap(texts[si], loose);
      return cache[k];
    }
    var tail = (/[^0-9A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ\s]+$/.exec(String(quote).trim()) || [""])[0].length;
    var passes = [false, true];
    for (var p = 0; p < passes.length; p++) {
      var q = qnorm(quote, passes[p]);
      if (q.length < 3) continue;
      for (var o = 0; o < order.length; o++) {
        var nm = nmOf(order[o], passes[p]), i = nm.f.indexOf(q);
        if (i < 0) continue;
        var r = range(texts[order[o]], nm, i, q.length);
        if (passes[p]) {            // loose: take the quote's closing punctuation back
          var tx = texts[order[o]], k2 = 0;
          while (k2 < tail && r.b < tx.length && !/\s/.test(tx.charAt(r.b)) && !ALNUM.test(fold(tx.charAt(r.b)))) { r.b++; k2++; }
        }
        return { s: order[o], a: r.a, b: r.b };
      }
    }
    // a long quote whose middle differs (an edited text, a clipping
    // limit): its first and last words, close together in one section
    var ql = qnorm(quote, true);
    if (ql.length >= 80) {
      var head = ql.slice(0, 32), end = ql.slice(-32);
      for (var o2 = 0; o2 < order.length; o2++) {
        var nl = nmOf(order[o2], true), h = nl.f.indexOf(head);
        while (h >= 0) {
          var e = nl.f.indexOf(end, h + head.length);
          if (e >= 0 && e + end.length - h <= ql.length * 1.5 + 64) {
            var ra = range(texts[order[o2]], nl, h, head.length), rb = range(texts[order[o2]], nl, e, end.length);
            return { s: order[o2], a: ra.a, b: rb.b };
          }
          h = nl.f.indexOf(head, h + 1);
        }
      }
    }
    return null;
  }

  // ---------- 9. Plan for one book ----------
  // ctx = { texts: [string] | null (file not on this device), fmt:
  //   "epub" | "pdf", marks: the book's current marks, cache }
  // → { add: [mark records without m], found, page, have, nopos, nofile }
  function planBook(src, book, ctx) {
    ctx = ctx || {};
    var texts = ctx.texts || null, pdf = ctx.fmt === "pdf" || book.fmt === "pdf";
    var mine = (ctx.marks || []).filter(function (k) { return k && k.b === book.id; });
    var ids = {}, quotes = {}, places = {};
    mine.forEach(function (k) {
      ids[k.id] = 1;
      if (k.k === "hl") { quotes[qnorm(k.q || "", true)] = 1; places[k.loc + ">" + k.end] = 1; }
      else places[k.loc] = 1;
    });
    var out = { add: [], found: 0, page: 0, have: 0, nopos: 0, nofile: 0 };
    var cache = ctx.cache || {};
    function push(rec, key) {
      if (ids[rec.id] || (key && places[key])) { out.have++; return false; }
      ids[rec.id] = 1;
      if (key) places[key] = 1;
      out.add.push(rec);
      return true;
    }
    function pageBm(it) {
      var pages = texts ? texts.length : (book.pages || 0);
      if (!pdf || !it.page || (pages && it.page > pages)) return false;
      var loc = C.makeLoc("p", it.page, 0, true);
      var rec = { id: markId(book.id, "bm", loc + "|" + qnorm(it.text || it.note || "", true).slice(0, 300)), b: book.id, k: "bm", loc: loc };
      if (it.text) rec.q = it.text.slice(0, C.QUOTE_LEN);
      if (it.note) rec.n = it.note.slice(0, C.NOTE_LEN);
      if (it.chapter) rec.lbl = it.chapter;
      if (push(rec, it.text || it.note ? "" : loc)) out.page++;
      return true;
    }
    src.items.forEach(function (it) {
      if (it.t === "hl") {
        var key = qnorm(it.text, true);
        if (quotes[key]) { out.have++; return; }
        if (!texts) {
          if (!pageBm(it)) out.nofile++;
          return;
        }
        var hint = pdf ? (it.page ? it.page - 1 : -1) : (typeof it.sec === "number" ? it.sec : -1);
        var at = locate(texts, it.text, hint, cache);
        if (!at || at.b <= at.a) {
          if (!pageBm(it)) out.nopos++;
          return;
        }
        var tx = texts[at.s], b = Math.min(at.b, at.a + C.QUOTE_LEN);
        var cx = C.contextOf(tx, at.a, b);
        var f = pdf ? "p" : "e", sec = pdf ? at.s + 1 : at.s;
        var rec = { id: markId(book.id, "hl", key.slice(0, 500)), b: book.id, k: "hl",
                    loc: C.makeLoc(f, sec, at.a), end: C.makeLoc(f, sec, b), c: it.c || 0, q: cx.q };
        if (cx.pre) rec.pre = cx.pre;
        if (cx.suf) rec.suf = cx.suf;
        if (it.note) rec.n = it.note;
        if (it.chapter) rec.lbl = it.chapter;
        if (push(rec, rec.loc + ">" + rec.end)) { out.found++; quotes[key] = 1; }
        return;
      }
      // a note without highlighted text, a bookmark: a page of a PDF,
      // or the start of the chapter KOReader names
      if (pageBm(it)) return;
      if (!pdf && typeof it.sec === "number" && it.sec >= 0 && (!texts || it.sec < texts.length)) {
        var loc = C.makeLoc("e", it.sec, 0);
        var r2 = { id: markId(book.id, "bm", loc + "|" + qnorm(it.note || "", true).slice(0, 300)), b: book.id, k: "bm", loc: loc };
        if (it.note) r2.n = it.note;
        if (it.chapter) r2.lbl = it.chapter;
        if (push(r2, it.note ? "" : loc)) out.page++;
        return;
      }
      out.nopos++;
    });
    return out;
  }

  // date range of a parse result → { from, to } (ms) or null
  function dateRange(res) {
    var a = 0, z = 0;
    ((res && res.books) || []).forEach(function (b) {
      b.items.forEach(function (it) {
        if (!it.date) return;
        if (!a || it.date < a) a = it.date;
        if (!z || it.date > z) z = it.date;
      });
    });
    return a ? { from: a, to: z } : null;
  }

  var API = {
    MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, matchBook: matchBook,
    locate: locate, planBook: planBook, dateRange: dateRange, normTitle: normTitle, markId: markId
  };
  if (NODE) module.exports = API;
  else root.OrosLibraryImport = API;
})(typeof self !== "undefined" ? self : this);
