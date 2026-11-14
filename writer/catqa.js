// ============================================================
// orOS Writer — catqa.js: glossary and quality checks for book
// translation (WR-CAT, wave T3). Pure: no DOM, no storage (catstore.js
// keeps the files). Tested in Node (tests/writer-catqa.test.js).
// i18n-inline-ok: Greek CSV header names and an example in a comment are parser data, no UI text
//   - terms: key "<from>-<to>-<16 hex>" (of the folded term) →
//     [term, translation, note, forbidden ("a; b"), stamp, deleted]
//     files entries-<dev>-<bucket>.json, merged like the memory's units
//   - Terms(maps, from, to): the terms of a segment (a whole word, or a
//     word with up to 3 more letters at its end: plural, Greek endings)
//   - check(src, rows, i, terms): the problems of one segment
//   - CSV and TBX (TBX-Basic / TBX v3) in and out, read as data
// Exposes window.WriterCatQA (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var TM = node ? require("./cattm.js") : root.WriterCatTM;
  var C = node ? require("./catcore.js") : root.WriterCatCore;

  var BUCKETS = 32, MAX_TERM = 300, MAX_NOTE = 2000, MAX_ENTRIES = 100000, MAX_FILE = 32 * 1024 * 1024;
  var KEY_RX = TM.KEY_RX, GL_RX = /^gl[a-z0-9]{6,30}$/;
  var WORD_RX = /[\p{L}\p{N}]+/gu, SUFFIX = 3;

  function str(s) { return s === undefined || s === null ? "" : String(s); }
  function fold(s) { return TM.fold(s); }
  function ws(s) { return TM.ws(s); }

  // ---------- entries ----------
  function keyOf(from, to, term) {
    var f = TM.base(from), t = TM.base(to), s = ws(fold(term));
    if (!f || !t || !s) return "";
    return f + "-" + t + "-" + TM.fnv(s, 0x811c9dc5) + TM.fnv(s, 0x050c5d1f);
  }
  function forbList(s) { return str(s).split(/\s*[;\n]\s*/).map(function (x) { return ws(x); }).filter(Boolean); }
  function cleanEntry(e) {
    if (!Array.isArray(e) || typeof e[0] !== "string" || typeof e[1] !== "string") return null;
    var m = Number(e[4]);
    if (!isFinite(m) || m <= 0 || Math.floor(m) !== m) return null;
    var term = ws(e[0]).slice(0, MAX_TERM);
    if (!term) return null;
    return [term, ws(e[1]).slice(0, MAX_TERM), str(e[2]).slice(0, MAX_NOTE), forbList(e[3]).join("; ").slice(0, MAX_NOTE), m, e[5] === 1 ? 1 : 0];
  }
  function newer(a, b) {
    if (!a) return b; if (!b) return a;
    if (a[4] !== b[4]) return a[4] > b[4] ? a : b;
    if (a[5] !== b[5]) return a[5] > b[5] ? a : b;
    return (a[1] + a[3] + a[2]) >= (b[1] + b[3] + b[2]) ? a : b;
  }
  function mergeEntries(list) {
    var out = {};
    (list || []).forEach(function (map) {
      if (!map || typeof map !== "object") return;
      Object.keys(map).forEach(function (k) {
        if (!KEY_RX.test(k)) return;
        var e = cleanEntry(map[k]);
        if (e) out[k] = newer(out[k], e);
      });
    });
    return out;
  }
  function bucketOf(key) { return TM.bucketOf(key); }
  function entriesName(name) {
    var m = /^entries-([a-z0-9]{6,32})-(\d{1,2})\.json$/.exec(str(name));
    return m && +m[2] < BUCKETS ? { dev: m[1], bucket: +m[2] } : null;
  }
  function entriesFile(dev, map) { return { v: 1, dev: dev, e: map }; }
  function readEntriesFile(obj, dev, bucket) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !obj.e || typeof obj.e !== "object") return {};
    var out = {};
    Object.keys(obj.e).forEach(function (k) {
      if (!KEY_RX.test(k) || bucketOf(k) !== bucket) return;
      var e = cleanEntry(obj.e[k]);
      if (e) out[k] = e;
    });
    return out;
  }
  function readGl(obj) {
    if (!obj || typeof obj !== "object" || obj.v !== 1 || !GL_RX.test(str(obj.id))) return null;
    return { v: 1, id: obj.id, name: str(obj.name).slice(0, 200), at: Number(obj.at) > 0 ? Math.floor(obj.at) : 0 };
  }
  function newGlId(now, rnd) {
    return "gl" + Math.floor(now).toString(36) + Math.floor(rnd * 1e9).toString(36).padStart(6, "0").slice(0, 6);
  }
  // a map's live entries of one pair → [{ key, term, tgt, note, forb[] , m }] by term
  function listOf(map, from, to) {
    var pre = TM.base(from) + "-" + TM.base(to) + "-", out = [];
    Object.keys(map || {}).forEach(function (k) {
      var e = map[k];
      if (k.indexOf(pre) !== 0 || !e || e[5]) return;
      out.push({ key: k, term: e[0], tgt: e[1], note: e[2], forb: forbList(e[3]), m: e[4] });
    });
    out.sort(function (a, b) { return fold(a.term) < fold(b.term) ? -1 : fold(a.term) > fold(b.term) ? 1 : 0; });
    return out;
  }

  // ---------- finding terms ----------
  // words of a text with their places (in the text as it is)
  function wordsAt(text) {
    var out = [], m, s = str(text);
    WORD_RX.lastIndex = 0;
    while ((m = WORD_RX.exec(s))) out.push({ w: fold(m[0]), a: m.index, b: m.index + m[0].length });
    return out;
  }
  function phraseWords(p) { return wordsAt(p).map(function (x) { return x.w; }); }
  // places where the phrase's words come in a row; the last one may
  // have up to 3 more letters (rain/rains, θάλασσα/θάλασσας)
  function findIn(words, pw) {
    var out = [];
    if (!pw.length) return out;
    for (var i = 0; i + pw.length <= words.length; i++) {
      var ok = true;
      for (var j = 0; j < pw.length && ok; j++) {
        var w = words[i + j].w, p = pw[j];
        if (j < pw.length - 1) ok = w === p;
        else ok = w === p || (p.length >= 4 && w.indexOf(p) === 0 && w.length - p.length <= SUFFIX);
      }
      if (ok) out.push({ a: words[i].a, b: words[i + pw.length - 1].b });
    }
    return out;
  }
  function Terms(maps, from, to) {
    var all = {};
    (maps || []).forEach(function (map) { Object.keys(map || {}).forEach(function (k) { all[k] = newer(all[k], map[k]); }); });
    var list = listOf(all, from, to), byWord = new Map();
    list.forEach(function (e) {
      e.pw = phraseWords(e.term);
      e.tw = phraseWords(e.tgt);
      e.fw = e.forb.map(phraseWords);
      if (!e.pw.length) return;
      var first = e.pw[0].slice(0, 4);
      if (!byWord.has(first)) byWord.set(first, []);
      byWord.get(first).push(e);
    });
    this.size = list.length;
    this.list = list;
    // the terms in a (plain) text → [{ a, b, e }], longest first where they overlap
    this.find = function (text) {
      var words = wordsAt(text), seen = {}, hits = [];
      words.forEach(function (x) {
        var c = byWord.get(x.w.slice(0, 4));
        if (!c) return;
        c.forEach(function (e) {
          if (seen[e.key]) return;
          var f = findIn(words, e.pw);
          if (f.length) { seen[e.key] = 1; f.forEach(function (h) { hits.push({ a: h.a, b: h.b, e: e }); }); }
        });
      });
      hits.sort(function (x, y) { return x.a - y.a || (y.b - y.a) - (x.b - x.a); });
      var out = [], end = -1;
      hits.forEach(function (h) { if (h.a >= end) { out.push(h); end = h.b; } });
      return out;
    };
    this.has = function (text, pw) { return findIn(wordsAt(text), pw).length > 0; };
  }

  // ---------- quality checks ----------
  // A problem: { k: code, a?, b? }. Codes: term, forb, num, tag, space,
  // punct, same (untranslated), lead (spaces at an end), cons (another
  // translation of the same source)
  var END_RX = /([.!?;:…]|\.\.\.)["'»”’)\]]*\s*$/;
  function endOf(s) {
    var m = END_RX.exec(str(s).trim());
    if (!m) return "";
    var c = m[1];
    if (c === "...") c = "…";
    return c;
  }
  // a Greek question mark is ";"; an English one is "?"
  function sameEnd(a, b, from, to) {
    if (a === b) return true;
    var q = function (c, l) { return c === "?" || (c === ";" && TM.base(l) === "el"); };
    return q(a, from) && q(b, to);
  }
  function numbers(s) {
    return (str(s).match(/\d+(?:[.,   ]\d{3})*(?:[.,]\d+)?/g) || []).map(function (n) {
      // 1,000.5 = 1.000,5 = 1 000,5 → digits and one decimal part
      var d = n.replace(/[   ]/g, ""), m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(d);
      var whole = m[1].replace(/[.,]/g, ""), frac = m[2] || "";
      if (/^\d{1,3}([.,]\d{3})+$/.test(d)) { whole = d.replace(/[.,]/g, ""); frac = ""; }
      return String(+whole) + (frac ? "." + frac : "");
    }).sort();
  }
  function check(src, rows, i, terms, opts) {
    opts = opts || {};
    var row = rows[i], out = [];
    if (!row || !row[0].trim()) return out;
    var sg = src.segs[i], s = C.plainText(src, i), t = str(row[0]).replace(/⟦\/?\d{1,4}\/?⟧/g, ""), from = opts.from, to = opts.to;
    if (terms) {
      terms.find(s).forEach(function (h) {
        if (h.e.tgt && !terms.has(t, h.e.tw)) out.push({ k: "term", a: h.e.term, b: h.e.tgt });
      });
      var seenF = {};
      terms.list.forEach(function (e) {
        if (!e.fw.length || seenF[e.key]) return;
        e.fw.forEach(function (fw, n) { if (!seenF[e.key] && fw.length && terms.has(t, fw)) { seenF[e.key] = 1; out.push({ k: "forb", a: e.forb[n], b: e.tgt || e.term }); } });
      });
    }
    var ns = numbers(s), nt = numbers(t);
    if (ns.join("|") !== nt.join("|")) {
      var miss = ns.filter(function (n) { var k = nt.indexOf(n); if (k >= 0) { nt.splice(k, 1); return false; } return true; });
      out.push({ k: "num", a: miss.join(", "), b: nt.join(", ") });
    }
    var tc = C.checkTags(src, i, row[0]);
    if (tc.missing.length || tc.twice.length || tc.order) out.push({ k: "tag", a: tc.missing.join(", ") });
    if (/\S {2,}\S/.test(t)) out.push({ k: "space" });
    if (/^\s|\s$/.test(str(row[0]))) out.push({ k: "lead" });
    var es = endOf(s), et = endOf(t);
    if (es !== et && !sameEnd(es, et, from, to)) out.push({ k: "punct", a: es, b: et });
    if (fold(ws(s)) === fold(ws(t)) && /\p{L}{3,}/u.test(s)) out.push({ k: "same" });
    return out;
  }
  // the same source translated differently in done segments: i → the other i
  function inconsistent(src, rows) {
    var by = {}, out = {};
    src.segs.forEach(function (sg, i) {
      var r = rows[i];
      if (!r || r[1] < C.ST_DONE || !r[0].trim()) return;
      var k = sg.s.trim();
      if (!by[k]) { by[k] = { i: i, t: ws(r[0]) }; return; }
      if (by[k].t !== ws(r[0])) out[i] = by[k].i;
    });
    return out;
  }
  // every problem in the book → [{ i, list }]
  function checkAll(src, rows, terms, opts) {
    var cons = inconsistent(src, rows), out = [];
    src.segs.forEach(function (sg, i) {
      var l = check(src, rows, i, terms, opts);
      if (cons[i] !== undefined) l.push({ k: "cons", a: String(cons[i] + 1) });
      if (l.length) out.push({ i: i, list: l });
    });
    return out;
  }

  // ---------- CSV ----------
  function parseCsvRows(text) {
    var s = str(text).replace(/^﻿/, ""), first = s.split(/\r?\n/, 1)[0] || "";
    var counts = { ",": 0, ";": 0, "\t": 0 }, q = false;
    for (var k = 0; k < first.length; k++) { var ch = first[k]; if (ch === "\"") q = !q; else if (!q && counts[ch] !== undefined) counts[ch]++; }
    var d = counts["\t"] >= counts[";"] && counts["\t"] >= counts[","] && counts["\t"] ? "\t" : counts[";"] > counts[","] ? ";" : ",";
    var rows = [], row = [], cell = "", i = 0, n = s.length, inQ = false;
    while (i < n) {
      var c = s[i];
      if (inQ) {
        if (c === "\"") { if (s[i + 1] === "\"") { cell += "\""; i += 2; continue; } inQ = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === "\"" && cell === "") { inQ = true; i++; continue; }
      if (c === d) { row.push(cell); cell = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(cell); cell = "";
        if (row.some(function (x) { return x.trim(); })) rows.push(row);
        row = [];
        if (c === "\r" && s[i + 1] === "\n") i++;
        i++;
        if (rows.length > MAX_ENTRIES + 1) break;
        continue;
      }
      cell += c; i++;
    }
    row.push(cell);
    if (row.some(function (x) { return x.trim(); })) rows.push(row);
    return rows;
  }
  // → { entries: [{ term, tgt, note, forb }], skipped }. Columns by
  // header (term/source/<from>, translation/target/<to>, note, forbidden),
  // else term, translation, note, forbidden in that order.
  function parseCsv(text, from, to) {
    var rows = parseCsvRows(text), out = [], skipped = 0;
    if (!rows.length) return { entries: out, skipped: 0 };
    var h = rows[0].map(function (x) { return fold(ws(x)); }), col = { term: -1, tgt: -1, note: -1, forb: -1 };
    var names = {
      term: ["term", "source", "source term", "όρος", "πρωτότυπο", "begriff", "quelle", TM.base(from)],
      tgt: ["translation", "target", "target term", "απόδοση", "μετάφραση", "übersetzung", "ziel", TM.base(to)],
      note: ["note", "notes", "comment", "definition", "σημείωση", "σχόλιο", "notiz", "anmerkung"],
      forb: ["forbidden", "do not use", "avoid", "απαγορευμένο", "απαγορευμένες", "verboten"]
    };
    Object.keys(names).forEach(function (k) {
      names[k].forEach(function (nm) { var at = h.indexOf(fold(nm)); if (at >= 0 && col[k] < 0) col[k] = at; });
    });
    var start = 1;
    // no header we know: the first row is data, in the order term, translation, note, forbidden
    if (col.term < 0 || col.tgt < 0) { col = { term: 0, tgt: 1, note: 2, forb: 3 }; start = 0; }
    rows.slice(start).forEach(function (r) {
      var term = ws(r[col.term]);
      if (!term || out.length >= MAX_ENTRIES) { skipped++; return; }
      out.push({ term: term, tgt: ws(r[col.tgt]), note: col.note >= 0 ? str(r[col.note]).trim() : "", forb: col.forb >= 0 ? forbList(r[col.forb]) : [] });
    });
    return { entries: out, skipped: skipped };
  }
  function csvCell(s) {
    s = str(s);
    // a cell a spreadsheet would run as a formula is kept as text
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\t\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }
  function csv(list, from, to) {
    var lines = [[TM.base(from), TM.base(to), "note", "forbidden"].map(csvCell).join(",")];
    list.forEach(function (e) { lines.push([e.term, e.tgt, e.note, (e.forb || []).join("; ")].map(csvCell).join(",")); });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // ---------- TBX ----------
  var X = TM.xml;
  function langOf(nd) { return TM.base(nd.a["xml:lang"] || nd.a.lang); }
  function all(nd, names) {
    var out = [];
    (function walk(n) { X.kids(n).forEach(function (k) { if (names.indexOf(k.n) >= 0) out.push(k); else walk(k); }); })(nd);
    return out;
  }
  function deprecated(t) {
    var bad = false;
    all(t, ["termnote"]).forEach(function (n) {
      var ty = str(n.a.type).toLowerCase(), v = fold(X.textOf(n));
      if (/administrativestatus|normativeauthorization/.test(ty) && /deprecated|superseded|forbidden|nonstandard/.test(v)) bad = true;
    });
    return bad;
  }
  // → { entries: [{ term, tgt, note, forb }], skipped }
  function parseTbx(text, from, to) {
    var s = str(text);
    if (s.length > MAX_FILE) return { err: "size", entries: [], skipped: 0 };
    var doc = X.parse(s), rootN = X.kids(doc).filter(function (k) { return k.n === "martif" || k.n === "tbx"; })[0];
    if (!rootN) return { err: "notbx", entries: [], skipped: 0 };
    var f = TM.base(from), t = TM.base(to), out = [], skipped = 0;
    all(rootN, ["termentry", "conceptentry"]).forEach(function (en) {
      var sets = all(en, ["langset", "langsec"]), src = [], tgt = [], bad = [], note = "";
      all(en, ["descrip", "note"]).forEach(function (d) {
        var ty = str(d.a.type).toLowerCase();
        if (!note && (d.n === "note" || ty === "definition" || ty === "context" || ty === "note")) note = ws(X.textOf(d));
      });
      sets.forEach(function (ls) {
        var l = langOf(ls);
        all(ls, ["tig", "ntig", "termsec"]).forEach(function (tg) {
          var tn = all(tg, ["term"])[0], v = tn ? ws(X.textOf(tn)) : "";
          if (!v) return;
          if (l === f) { if (!deprecated(tg)) src.push(v); }
          else if (l === t) { if (deprecated(tg)) bad.push(v); else tgt.push(v); }
        });
      });
      if (!src.length || out.length >= MAX_ENTRIES) { skipped++; return; }
      src.forEach(function (term) { out.push({ term: term, tgt: tgt[0] || "", note: note, forb: bad }); });
    });
    return { entries: out, skipped: skipped };
  }
  function tbx(list, from, to) {
    var e = TM.xesc, f = TM.base(from), t = TM.base(to);
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<martif type="TBX-Basic" xml:lang="en">',
      "<martifHeader><fileDesc><sourceDesc><p>orOS Writer</p></sourceDesc></fileDesc></martifHeader>", "<text><body>"];
    list.forEach(function (x, n) {
      var s = '<termEntry id="e' + (n + 1) + '">' + (x.note ? '<descrip type="definition">' + e(x.note) + "</descrip>" : "") +
        '<langSet xml:lang="' + e(f) + '"><tig><term>' + e(x.term) + "</term></tig></langSet>";
      var tg = "";
      if (x.tgt) tg += "<tig><term>" + e(x.tgt) + '</term><termNote type="administrativeStatus">preferredTerm-admn-sts</termNote></tig>';
      (x.forb || []).forEach(function (b) { tg += "<tig><term>" + e(b) + '</term><termNote type="administrativeStatus">deprecatedTerm-admn-sts</termNote></tig>'; });
      if (tg) s += '<langSet xml:lang="' + e(t) + '">' + tg + "</langSet>";
      out.push(s + "</termEntry>");
    });
    out.push("</body></text>", "</martif>", "");
    return out.join("\n");
  }

  var api = {
    BUCKETS: BUCKETS, GL_RX: GL_RX, KEY_RX: KEY_RX, MAX_FILE: MAX_FILE,
    keyOf: keyOf, cleanEntry: cleanEntry, mergeEntries: mergeEntries, bucketOf: bucketOf, entriesName: entriesName,
    entriesFile: entriesFile, readEntriesFile: readEntriesFile, readGl: readGl, newGlId: newGlId, listOf: listOf, forbList: forbList,
    Terms: Terms, check: check, checkAll: checkAll, inconsistent: inconsistent, numbers: numbers,
    parseCsv: parseCsv, csv: csv, parseTbx: parseTbx, tbx: tbx
  };
  if (node) module.exports = api;
  else root.WriterCatQA = api;
})(this);
