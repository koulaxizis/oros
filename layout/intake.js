// ============================================================
// orOS Layout — Book intake: the questions and the book sheet
// (v1.0.0, LY-IN)
// Before the automatic layout (layout/autolay.js, LY-AUTO) makes a
// book, Layout asks how this book is to be set: a fixed list of
// questions, each with "as in the series" first (the house style's own
// answer, layout/house.js). The answers are the book sheet, kept in
// the new document's setup.ext.book (R39) and offered again for a new
// layout; "keep as the series' rules" stores them in the house style
// (setup.ext.house.answers) as the series' answers.
//   sheet: { v: 1, a: { question id: value }, ty: { part: look },
//            drop: [page id], ded: text, motto: text }
//   a value missing or "s" = as in the series. look: { fam, size,
//   lead, align, b, i, caps, track } (each optional).
//   - info(house, list, cut) → what the manuscript (structured wordin
//     paragraphs; cut: its own front matter, left out, where a
//     dedication may be) and the house style hold: parts, scene breaks,
//     sections (prologue, thanks…), the dedication, the front and back
//     pages, and the series' own answers for the labels.
//   - defaults(house) → a sheet with the series' saved answers.
//   - mark(list, sheet, inf) → the list with its parts, scene breaks
//     and sections set (p.ps) and moved; dedication and motto out.
//   - prepare(house, sheet, inf, opts) → a copy of the house style
//     with the answers applied (page size, margins, chapter starts,
//     sunk titles, first paragraphs, page numbers, contents, pages
//     left out, dedication and motto pages, typography per part,
//     hyphenation, widows, text fixes) and setup.ext.book.
//   - finish(doc, L) → pages where a title opens and empty pages get
//     the master without page numbers, when the sheet hides them.
// Pure (designkit + house.js), testable under Node.
// Exposes LY_INTAKE (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M, T, H;
  if (typeof module !== "undefined" && module.exports) {
    M = require("../designkit/model.js"); T = require("../designkit/text.js"); H = require("./house.js");
  } else { M = root.orosDK.model; T = root.orosDK.text; H = root.LY_HOUSE; }

  var MM = 72 / 25.4;
  // the questions: id, group, values (the first, "s", is the series')
  var QUESTIONS = [
    { id: "size", g: "page", v: ["s", "120x190", "140x210", "148x210", "170x240"] },
    { id: "start", g: "page", v: ["s", "odd", "even", "page", "run"] },
    { id: "parts", g: "page", v: ["s", "own", "chap"], when: "parts" },
    { id: "sink", g: "page", v: ["s", "top", "third"] },
    { id: "first", g: "page", v: ["s", "flush", "indent"] },
    { id: "sep", g: "page", v: ["s", "keep", "***", "* * *", "⁂", "blank"], when: "seps" },
    { id: "pn", g: "page", v: ["s", "footC", "footOut", "headOut", "headC", "none"] },
    { id: "pnHide", g: "page", v: ["s", "hide", "show"] },
    { id: "toc", g: "page", v: ["s", "start", "end", "none"] },
    { id: "tocParts", g: "page", v: ["s", "parts", "chap"], when: "parts" },
    { id: "picAt", g: "pics", v: ["s", "page", "before", "each", "out"], when: "pics" },
    { id: "picSize", g: "pics", v: ["s", "text", "page"], when: "pics" },
    { id: "cap", g: "pics", v: ["s", "below", "above", "none"], when: "pics" },
    { id: "capSrc", g: "pics", v: ["s", "file", "typed"], when: "pics" },
    { id: "grey", g: "pics", v: ["s", "yes"], when: "pics" },
    { id: "hyph", g: "text", v: ["s", "on", "off"] },
    { id: "widows", g: "text", v: ["s", "on", "off"] },
    { id: "fix", g: "text", v: ["s", "on", "off"] }
  ];
  // where a section of the manuscript goes
  var AT = ["s", "front", "back", "out"];
  // the parts of a book a typography answer sets
  var PARTS = ["body", "title", "part", "toc", "colophon", "thanks", "links", "ded", "cap"];
  // where one picture goes (the "each" answer, sheet.pics[k].at)
  var PIC_AT = ["s", "page", "before", "out"];
  // a paragraph right after a picture that reads as its caption
  var CAP_RE = /^(φωτ|εικ|photo|fig|abb|bild|πηγη|source|quelle)/;
  var LOOK = ["fam", "size", "lead", "align", "b", "i", "caps", "track"];
  var SIZES = { "120x190": [120, 190], "140x210": [140, 210], "148x210": [148, 210], "170x240": [170, 240] };

  // Greek without accents, lower case, final sigma as sigma
  var PLAIN = { "ά": "α", "έ": "ε", "ή": "η", "ί": "ι", "ϊ": "ι", "ΐ": "ι", "ό": "ο", "ύ": "υ", "ϋ": "υ", "ΰ": "υ", "ώ": "ω", "ς": "σ", "ü": "u", "ö": "o", "ä": "a" };
  function fold(t) { return String(t || "").toLowerCase().replace(/[άέήίϊΐόύϋΰώςüöä]/g, function (c) { return PLAIN[c]; }).replace(/\s+/g, " ").trim(); }
  // i18n-inline-ok: section titles a manuscript may use, data
  var SECTIONS = {
    ded: /^(αφιερωση|dedication|widmung)$/,
    motto: /^(μοτο|motto|epigraph|επιγραφη)$/,
    prologue: /^(προλογοσ|προλεγομενα|εισαγωγη|prologue|preface|foreword|introduction|vorwort|prolog|einleitung)$/,
    thanks: /^(ευχαριστιεσ|ευχαριστω|acknowledg(e)?ments?|thanks|danksagung|dank)$/,
    notes: /^(σημειωσεισ|notes|anmerkungen)$/,
    bio: /^(βιογραφικο|βιογραφικο σημειωμα|για τ(ον|ην) συγγραφεα|σχετικα με τ(ον|ην) συγγραφεα|about the author|uber (den|die) autor(in)?)$/,
    links: /^(συνδεσμοι|χρησιμοι συνδεσμοι|links|weblinks|useful links)$/
  };
  var SECTION_KEYS = ["ded", "motto", "prologue", "thanks", "notes", "bio", "links"];
  var PART_RE = /^(μεροσ|βιβλιο|part|book|teil)\s+\S{1,14}$/;

  function textOf(p) { return (p.runs || []).map(function (r) { return r.t || ""; }).join(""); }
  function head(p) { return /^h/.test(p.role); }
  function sectionOf(p) {
    if (!head(p)) return "";
    var t = fold(textOf(p)).replace(/[.:·]+$/, "");
    if (t.length > 40) return "";
    for (var i = 0; i < SECTION_KEYS.length; i++) if (SECTIONS[SECTION_KEYS[i]].test(t)) return SECTION_KEYS[i];
    return "";
  }
  // the question "where does this section go": atThanks, atBio…
  function atKey(k) { return "at" + k.charAt(0).toUpperCase() + k.slice(1); }
  // a sheet as it may be kept (setup.ext keys and values, R39): the
  // known questions only
  function clean(sheet) {
    sheet = sheet && typeof sheet === "object" ? sheet : {};
    var a = {}, ty = {}, ok = {}, src = sheet.a || {}, look = sheet.ty || {};
    QUESTIONS.forEach(function (q) { ok[q.id] = q.v; });
    SECTION_KEYS.forEach(function (k) { ok[atKey(k)] = AT; });
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (ok[k] && ok[k].indexOf(v) >= 0) a[k] = v;
      else if (k === "pnStart" && v !== "" && isFinite(Number(v))) a[k] = Math.max(0, Math.min(9999, Math.floor(Number(v))));
      else if (k === "extraAt" && /^(end|after\d{1,4})$/.test(v)) a[k] = v;
      else if (k === "marg" && v && typeof v === "object") {
        var m = {};
        ["t", "b", "i", "o"].forEach(function (e) { var n = Number(v[e]); if (v[e] !== "" && v[e] !== null && isFinite(n) && n >= 0 && n < 200) m[e] = n; });
        if (Object.keys(m).length) a.marg = m;
      }
    });
    PARTS.forEach(function (p) {
      var l = look[p], o = {};
      if (!l || typeof l !== "object") return;
      LOOK.forEach(function (k) {
        var v = l[k];
        if (v === undefined || v === null || v === "") return;
        if (k === "fam") { if (/^(serif|sans|mono)$|^(fs|uf)_[A-Za-z0-9_-]{1,80}$/.test(v)) o.fam = v; }
        else if (k === "align") { if (/^[lcrj]$/.test(v)) o.align = v; }
        else if (k === "b" || k === "i" || k === "caps") o[k] = v ? 1 : 0;
        else if (isFinite(Number(v))) o[k] = Number(v);
      });
      if (Object.keys(o).length) ty[p] = o;
    });
    var out = { v: 1, a: a, ty: ty, drop: (Array.isArray(sheet.drop) ? sheet.drop : []).filter(function (id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id); }).slice(0, 64) };
    ["ded", "motto"].forEach(function (k) { if (typeof sheet[k] === "string") out[k] = sheet[k].replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 2000); });
    // one entry per picture, in order (the manuscript's, then the others)
    if (Array.isArray(sheet.pics)) {
      out.pics = sheet.pics.slice(0, 500).map(function (x) {
        var o = {};
        if (x && PIC_AT.indexOf(x.at) > 0) o.at = x.at;
        if (x && typeof x.cap === "string") o.cap = x.cap.replace(/[\u0000-\u001F]/g, " ").trim().slice(0, 300);
        return o;
      });
    }
    return out;
  }
  function isPart(p) { var t = fold(textOf(p)); return head(p) && t.length <= 40 && PART_RE.test(t); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function stamp(v) { return typeof v === "number" && v > 0 ? Math.floor(v) : 1; }

  // ---------- 1. What the manuscript and the house hold ----------
  // blocks: a section is its title and what follows up to the next title
  function blocks(list) {
    var out = [], cur = null;
    list.forEach(function (p, i) {
      if (head(p) || !cur) { cur = { from: i, to: i, key: head(p) ? sectionOf(p) : "", part: isPart(p) }; out.push(cur); }
      cur.to = i;
    });
    return out;
  }
  function tocStory(d) { var st = null; d.stories.forEach(function (s) { if (s.ext && s.ext.hs === "toc") st = s; }); return st; }
  function pagesOfStory(d, sid) {
    var on = {};
    d.items.forEach(function (it) { if (it.story === sid && !M.find(d.masters, it.pg)) on[it.pg] = 1; });
    return on;
  }
  function bodyPage(d) { return M.pagesInOrder(d).filter(function (p) { return p.ext && p.ext.hs === "body"; })[0] || null; }
  function colophon(d) {
    return d.stories.filter(function (st) {
      return !(st.ext && st.ext.hs) && st.paras.some(function (p) { return /\{(isbn|year|έτος|publisher|εκδότης)\}/i.test(textOf(p)); });
    });
  }
  function looksOf(d, id) {
    var s = id && M.find(d.pstyles, id);
    if (!s) return null;
    var r = T.resolvePs(T.byId(d.pstyles), id);
    return { fam: r.fam || r.font, size: r1(r.size), lead: r1(r.lead || r.size * 1.2), align: r.align, b: r.b ? 1 : 0, i: r.i ? 1 : 0, caps: r.caps ? 1 : 0, track: r.track || 0 };
  }
  function info(house, list, cut) {
    var h = H.houseOf(house) || { roles: {}, rules: [] }, ro = h.roles || {};
    var out = { parts: 0, seps: 0, sepText: "", sections: {}, ded: "", motto: "", titles: 0, pages: [], colophon: false, series: {}, pics: 0, chapters: [] };
    var sepN = {};
    (list || []).forEach(function (p) {
      if (head(p)) out.titles++;
      if (head(p) && !sectionOf(p)) out.chapters.push(textOf(p).trim().slice(0, 80));
      if (p.pics) out.pics += p.pics.length;
      if (isPart(p)) out.parts++;
      var t = textOf(p).trim();
      if (!head(p) && H.isSep(t)) { out.seps++; sepN[t] = (sepN[t] || 0) + 1; }
    });
    out.sepText = Object.keys(sepN).sort(function (a, b) { return sepN[b] - sepN[a]; })[0] || "";
    [cut || [], list || []].forEach(function (ps, k) {
      blocks(ps).forEach(function (b) {
        if (!b.key) return;
        var body = ps.slice(b.from + 1, b.to + 1).map(textOf).filter(function (t) { return t.trim(); });
        if (b.key === "ded" || b.key === "motto") { if (!out[b.key]) out[b.key] = body.join("\n").slice(0, 2000); return; }
        if (k) out.sections[b.key] = (out.sections[b.key] || 0) + 1;
      });
    });
    // the front and back pages of the house style
    var toc = tocStory(house), tocOn = toc ? pagesOfStory(house, toc.id) : {}, order = M.pagesInOrder(house), first = M.firstNumber(house);
    order.forEach(function (pg, i) {
      var side = pg.ext && pg.ext.hs;
      if (side !== "front" && side !== "back") return;
      var txt = "";
      house.items.forEach(function (it) {
        if (txt || it.pg !== pg.id || it.t !== "text") return;
        var st = M.find(house.stories, it.story);
        if (st) st.paras.some(function (p) { var x = textOf(p).trim(); if (x) { txt = x; return true; } return false; });
      });
      out.pages.push({ id: pg.id, side: side, no: i + first, text: txt.slice(0, 60), toc: !!tocOn[pg.id] });
    });
    out.colophon = colophon(house).length > 0;
    // the series' answers, for "as in the series (…)"
    var u = house.setup, s = out.series, bp = bodyPage(house);
    s.size = r1(u.w / MM) + "×" + r1(u.h / MM);
    s.marg = { t: r1(u.mt / MM), b: r1(u.mb / MM), i: r1(u.mi / MM), o: r1(u.mo / MM) };
    var title = ro.title && T.resolvePs(T.byId(house.pstyles), ro.title);
    s.start = title ? title.brk || "run" : "run";
    var sink = h.rules.filter(function (r) { return r.code === "w.sink" && r.p; })[0];
    s.sink = title && title.sink ? r1(title.sink / MM) : sink ? sink.p.mm : 0;
    var body = looksOf(house, ro.body), firstLk = ro.first && T.resolvePs(T.byId(house.pstyles), ro.first);
    var bodyR = ro.body && T.resolvePs(T.byId(house.pstyles), ro.body);
    s.first = !firstLk ? (bodyR && bodyR.fi > 0 ? "indent" : "flush") : firstLk.fi > 0 ? "indent" : "flush";
    s.sep = h.sep || "";
    var pnOn = bp && bp.ms ? H.pnItems(house, bp.ms) : [];
    s.pn = pnOn.length ? (h.pn && h.pn.at) || "footC" : "none";
    s.pnHide = h.pn && h.pn.hide ? "hide" : "show";
    s.pnStart = first;
    var tocAt = "none";
    out.pages.forEach(function (p) { if (p.toc) tocAt = p.side === "front" ? "start" : "end"; });
    s.toc = tocAt;
    s.hyph = bodyR && bodyR.hyph ? "on" : "off";
    s.widows = bodyR && (bodyR.orph || 1) > 1 ? "on" : "off";
    s.fix = h.rules.some(function (r) { return r.on && r.a && r.a.k === "fix"; }) ? "on" : "off";
    s.ty = { body: body, title: looksOf(house, ro.title), cap: looksOf(house, ro.note) };
    var hp = h.pics || {};
    s.picAt = hp.at || "page"; s.picSize = hp.size || "text"; s.cap = hp.cap || "below"; s.capSrc = "para"; s.grey = "no";
    if (toc) { var e = toc.paras.filter(function (p) { return /\d\s*$/.test(textOf(p)); })[0]; if (e) s.ty.toc = looksOf(house, e.ps); }
    var col = colophon(house)[0];
    if (col) s.ty.colophon = looksOf(house, col.paras[0].ps);
    return out;
  }

  function defaults(house) {
    var h = H.houseOf(house), ans = h && h.answers;
    return { v: 1, a: ans && ans.a ? copy(ans.a) : {}, ty: ans && ans.ty ? copy(ans.ty) : {}, drop: [] };
  }
  // the answer to a question: the sheet's, else the series'
  function ans(sheet, id) { var v = sheet && sheet.a && sheet.a[id]; return v === undefined || v === null || v === "" ? "s" : v; }

  // ---------- 2. The manuscript ----------
  // The pictures out of the list (wordin { role "img" } entries, with
  // a, nm, iw, ih once imported): each goes with the paragraph after it
  // (p.pics: indexes); a short paragraph right after it that reads as a
  // caption (all italic, centred, or "Photo…", "Φωτ…") is its caption
  // candidate. → { list, pics: [{ src, alt, a, nm, iw, ih, cap }] }
  function pictures(list) {
    var out = [], pics = [], wait = [];
    (list || []).forEach(function (p) {
      if (p.role === "img") {
        wait.push(pics.length);
        pics.push({ src: String(p.src || ""), alt: String(p.alt || ""), a: p.a || "", nm: p.nm || "", iw: p.iw || 0, ih: p.ih || 0 });
        return;
      }
      if (!wait.length || !p.runs.length) { out.push(p); return; }
      var q = {};
      Object.keys(p).forEach(function (k) { q[k] = p[k]; });
      q.pics = (p.pics || []).concat(wait);
      var t = textOf(p).trim();
      var italic = p.runs.every(function (r) { return r.i || !String(r.t).trim(); });
      if (!head(p) && t.length <= 300 && (italic || p.role === "center" || CAP_RE.test(fold(t)))) {
        wait.forEach(function (k) { pics[k].cap = t; });
        q.capOf = 1;
      }
      wait = [];
      out.push(q);
    });
    // pictures at the very end go with the last paragraph
    if (wait.length) {
      for (var i = out.length - 1; i >= 0; i--) if (out[i].runs.length) { out[i] = copyP(out[i]); out[i].pics = (out[i].pics || []).concat(wait); break; }
    }
    return { list: out, pics: pics };
  }
  function copyP(p) { var q = {}; Object.keys(p).forEach(function (k) { q[k] = p[k]; }); return q; }
  // → { list, moved: n, dropped: n }
  function mark(list, sheet, inf) {
    sheet = clean(sheet);
    var B = blocks(list || []), keep = [], front = [], back = [], dropped = 0, moved = 0;
    var parts = ans(sheet, "parts"), start = ans(sheet, "start"), sep = ans(sheet, "sep");
    var run = start === "run" || (start === "s" && !!inf && inf.series.start === "run");
    var capPara = ans(sheet, "capSrc") === "s" && ans(sheet, "cap") !== "none";
    var sepTxt = sep === "s" ? (inf && inf.series.sep) || "" : sep;
    var firstChapter = -1;
    B.forEach(function (b, k) { if (firstChapter < 0 && !b.key && head(list[b.from])) firstChapter = k; });
    var afterPart = false;
    B.forEach(function (b, k) {
      var ps = b.key === "thanks" ? "ps-hsthanks" : b.key === "links" ? "ps-hslinks" : "";
      var paras = list.slice(b.from, b.to + 1).map(function (p, i) {
        var o = { role: p.role, runs: p.runs };
        if (p.guessed) o.guessed = 1;
        if (p.pics) o.pics = p.pics;
        if (p.capOf && capPara) o.capOf = 1;
        if (i === 0 && b.part && parts !== "chap") { o.ps = "ps-hspart"; afterPart = true; return o; }
        if (i === 0 && head(p) && afterPart) { if (run) o.ps = "ps-hsopen"; afterPart = false; }
        if (i > 0 && ps) o.ps = ps;
        if (i > 0 && !head(p) && H.isSep(textOf(p))) {
          if (sepTxt === "blank") o.runs = [];
          else if (sepTxt && sepTxt !== "keep") o.runs = [{ t: sepTxt }];
          o.ps = "ps-hssep";
        }
        return o;
      });
      if (b.key === "ded" || b.key === "motto") { dropped += paras.length; return; }
      var at = b.key ? ans(sheet, atKey(b.key)) : "s";
      if (at === "out") { dropped += paras.length; return; }
      if (at === "front" && k > firstChapter && firstChapter >= 0) { front = front.concat(paras); moved++; return; }
      if (at === "back") { back = back.concat(paras); moved++; return; }
      keep = keep.concat(paras);
    });
    // front sections go before the first chapter
    var at0 = 0;
    for (var i = 0; i < keep.length; i++) { if (head(keep[i]) && !sectionOf(keep[i])) { at0 = i; break; } at0 = i + 1; }
    var out = keep.slice(0, at0).concat(front, keep.slice(at0), back);
    // a caption paragraph leaves the text; its pictures go with the next one
    var carry = [], caps = 0;
    out = out.filter(function (p, i) {
      if (carry.length && !p.capOf) { p.pics = (p.pics || []).concat(carry); carry = []; }
      if (!p.capOf) return true;
      carry = carry.concat(p.pics || []);
      caps++;
      if (i === out.length - 1) {
        for (var k = i - 1; k >= 0; k--) if (!out[k].capOf) { out[k].pics = (out[k].pics || []).concat(carry); break; }
      }
      return false;
    });
    return { list: out, moved: moved, dropped: dropped, caps: caps };
  }

  // ---------- 3. The house style with the answers ----------
  function ps(d, id) { return M.find(d.pstyles, id); }
  function extOf(s) { s.ext = s.ext || {}; return s.ext; }
  // a style of its own on a base (replaced when there)
  function derive(d, id, base, name, set, now) {
    var s = { id: id, m: stamp(now), name: String(name || id).slice(0, 60), base: base };
    Object.keys(set || {}).forEach(function (k) { if (k === "ext") s.ext = copy(set.ext); else s[k] = set[k]; });
    d.pstyles = d.pstyles.filter(function (x) { return x.id !== id; }).concat([s]);
    return s;
  }
  function setLook(d, s, look) {
    if (!s || !look) return;
    LOOK.forEach(function (k) {
      var v = look[k];
      if (v === undefined || v === null || v === "") return;
      if (k === "fam") {
        if (/^(serif|sans|mono)$/.test(v)) { s.font = v; if (s.ext) delete s.ext.fam; }
        else if (/^(fs|uf)_/.test(v)) extOf(s).fam = v;
        return;
      }
      if (k === "align") { if (/^[lcrj]$/.test(v)) s.align = v; return; }
      if (k === "b" || k === "i" || k === "caps") { s[k] = v ? 1 : 0; return; }
      var n = Number(v);
      if (!isFinite(n)) return;
      if (k === "size") s.size = Math.max(4, Math.min(200, n));
      else if (k === "lead") s.lead = Math.max(0, Math.min(400, n));
      else s.track = Math.max(-200, Math.min(1000, n));
    });
    if (s.ext && !Object.keys(s.ext).length) delete s.ext;
  }
  function reorder(d, order) { order.forEach(function (p, i) { p.pos = (i + 1) * 1024; }); d.pages = order; }
  function dropPages(d, ids) {
    var gone = {};
    ids.forEach(function (id) { gone[id] = 1; });
    var order = M.pagesInOrder(d).filter(function (p) { return !gone[p.id] || !(p.ext && (p.ext.hs === "front" || p.ext.hs === "back")); });
    var left = {};
    order.forEach(function (p) { left[p.id] = 1; });
    d.items = d.items.filter(function (it) { return left[it.pg] || M.find(d.masters, it.pg); });
    d.guides = (d.guides || []).filter(function (g) { return left[g.pg] || M.find(d.masters, g.pg); });
    var used = {};
    d.items.forEach(function (it) { if (it.story) used[it.story] = 1; });
    d.stories = d.stories.filter(function (st) { return used[st.id]; });
    reorder(d, order);
  }
  // a page with one frame inside the margins, after `after` (page id)
  // or before the body page, on a right-hand page when right is set
  function textPage(d, where, paras, opts) {
    var order = M.pagesInOrder(d), bp = bodyPage(d), at = where === "back" ? order.indexOf(bp) + 1 : order.indexOf(bp);
    if (at < 0) at = order.length;
    var pages = [];
    if (opts.right && d.setup.facing && at % 2 === 1) pages.push({ id: M.newId("pg"), m: stamp(opts.now), pos: 0, ms: "", ext: { hs: where } });
    var pg = { id: M.newId("pg"), m: stamp(opts.now), pos: 0, ms: "", ext: { hs: where } };
    pages.push(pg);
    order.splice.apply(order, [at, 0].concat(pages));
    reorder(d, order);
    var m = M.margins(d, M.sideOf(d, order.indexOf(pg))), u = d.setup, top = opts.low ? Math.max(m.t, u.h / 3) : m.t;
    var sid = M.newId("st");
    var st = { id: sid, m: stamp(opts.now), paras: paras };
    if (opts.hs) st.ext = { hs: opts.hs };
    d.stories.push(st);
    d.items.push({ id: M.newId("it"), m: stamp(opts.now), t: "text", pg: pg.id, x: m.l, y: top, w: Math.max(10, u.w - m.l - m.r), h: Math.max(10, u.h - m.b - top), cols: 1, gut: u.gut, story: sid, seq: 1, z: 1 });
    return pg;
  }
  function scale(d, sx, sy) {
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return;
    d.items.forEach(function (it) { it.x *= sx; it.y *= sy; it.w *= sx; it.h *= sy; });
    (d.guides || []).forEach(function (g) { g.p *= g.o === "h" ? sy : sx; });
  }
  function pnPlace(d, at, side, h0) {
    var u = d.setup, m = M.margins(d, side || "R"), w = at.slice(-1) === "C" ? 60 : Math.max(24, h0 * 1.2), h = h0;
    var y = at.indexOf("foot") === 0 ? u.h - m.b / 2 - h / 2 : m.t / 2 - h / 2;
    var right = side !== "L", x;
    if (/C$/.test(at)) x = u.w / 2 - w / 2;
    else if (/Out$/.test(at)) x = right ? u.w - m.r - w : m.l;
    else x = right ? m.l : u.w - m.r - w;
    return { x: x, y: Math.max(0, y), w: w, h: h };
  }

  // opts { now, names: { part, open, sep, toc, tocHead, thanks, links, ded, pn }, tocHead (text) }
  function prepare(house, sheet, inf, opts) {
    opts = opts || {};
    var now = opts.now, N = opts.names || {};
    sheet = clean(sheet);
    var d = copy(house), h = d.setup.ext.house, ro = h.roles, u = d.setup;
    var A = function (id) { return ans(sheet, id); };
    var book = { v: 1, a: copy(sheet.a), ty: copy(sheet.ty), drop: sheet.drop.slice() };
    if (sheet.pics) book.pics = copy(sheet.pics);
    if (typeof house.id === "string") book.house = house.id;
    var body = ro.body || "ps-base", title = ro.title || body;
    // pages left out
    if (book.drop.length) dropPages(d, book.drop);
    // page size and margins
    var sz = SIZES[A("size")];
    if (sz) {
      var w = sz[0] * MM, hh = sz[1] * MM;
      scale(d, w / u.w, hh / u.h);
      u.w = w; u.h = hh; u.preset = "custom";
    }
    var mg = sheet.a.marg;
    if (mg && typeof mg === "object") ["t", "b", "i", "o"].forEach(function (k) { var v = Number(mg[k]); if (isFinite(v) && v >= 0 && v < 200) u["m" + k] = v * MM; });
    // chapters: where they start, how far down
    var ts = ps(d, title);
    if (ts) {
      var st = A("start");
      if (st !== "s") extOf(ts).brk = st === "run" ? "any" : st;
      var sk = A("sink");
      var rule = h.rules.filter(function (r) { return r.code === "w.sink" && r.p; })[0];
      if (sk === "top") extOf(ts).sink = 0;
      else if (sk === "third") extOf(ts).sink = Math.max(0, Math.round(u.h / 3 - u.mt));
      else if (rule && extOf(ts).sink === undefined) ts.ext.sink = Math.round(rule.p.mm * MM);
      if (ts.ext && !Object.keys(ts.ext).length) delete ts.ext;
    }
    // the first paragraph
    var fa = A("first"), bs = ps(d, body);
    if (fa !== "s" && bs) {
      var bfi = T.resolvePs(T.byId(d.pstyles), body).fi;
      var fs = ro.first && ps(d, ro.first);
      if (!fs) { fs = derive(d, "ps-hsfirst", body, N.first || "first", {}, now); ro.first = fs.id; }
      fs.fi = fa === "flush" ? 0 : bfi > 0 ? bfi : Math.round(T.resolvePs(T.byId(d.pstyles), body).size);
    }
    // parts, scene breaks, sections: styles of their own
    var tsr = T.resolvePs(T.byId(d.pstyles), title);
    if (inf.parts && A("parts") !== "chap") {
      derive(d, "ps-hspart", title, N.part, { align: "c", ext: { brk: "odd", sink: Math.max(0, Math.round(u.h / 3 - u.mt)) } }, now);
      if (!tsr.brk) derive(d, "ps-hsopen", title, N.open, { ext: { brk: "page" } }, now);
      book.partPs = A("tocParts") === "chap" ? [] : ["ps-hspart"];
    }
    if (inf.seps) derive(d, "ps-hssep", body, N.sep, { align: "c", fi: 0, sb: 0, sa: 0, ext: { hyph: 0 } }, now);
    if (inf.sections.thanks) derive(d, "ps-hsthanks", body, N.thanks, {}, now);
    if (inf.pics || (opts.extra || 0) > 0) {
      var cr = T.resolvePs(T.byId(d.pstyles), ro.note || body);
      derive(d, "ps-hscap", ro.note || body, N.cap, { align: "c", i: 1, fi: 0, li: 0, ri: 0, sb: 0, sa: 0, size: Math.max(7, Math.min(cr.size, T.resolvePs(T.byId(d.pstyles), body).size - 2)), ext: { hyph: 0, brk: "any" } }, now);
    }
    if (inf.sections.links) derive(d, "ps-hslinks", body, N.links, { fi: 0, align: "l", ext: { hyph: 0 } }, now);
    // contents: where, or none; made when the house has none
    var toc = tocStory(d), ta = A("toc");
    if (toc && ta === "none") {
      dropPages(d, Object.keys(pagesOfStory(d, toc.id)));
      toc = null;
    } else if (toc && (ta === "start" || ta === "end")) {
      var on = pagesOfStory(d, toc.id), order = M.pagesInOrder(d), moving = order.filter(function (p) { return on[p.id]; });
      var side = ta === "start" ? "front" : "back";
      if (moving.some(function (p) { return !p.ext || p.ext.hs !== side; })) {
        order = order.filter(function (p) { return !on[p.id]; });
        var bi = order.indexOf(bodyPage(d));
        moving.forEach(function (p) { p.ext = p.ext || {}; p.ext.hs = side; });
        order.splice.apply(order, [side === "front" ? bi : bi + 1, 0].concat(moving));
        reorder(d, order);
      }
    } else if (!toc && (ta === "start" || ta === "end")) {
      derive(d, "ps-hstochead", title, N.tocHead, { ext: { brk: "any", sink: 0, kwn: 1 } }, now);
      derive(d, "ps-hstoc", body, N.toc, { fi: 0, align: "l", sb: 0, ext: { hyph: 0, brk: "any" } }, now);
      textPage(d, ta === "start" ? "front" : "back", [{ ps: "ps-hstochead", runs: [{ t: String(opts.tocHead || "Contents").slice(0, 80) }] }, { ps: "ps-hstoc", runs: [{ t: "…\t1" }] }], { now: now, hs: "toc", right: ta === "start" });
      toc = tocStory(d);
    }
    // the contents entries in a style of their own when it is set
    if (toc && book.ty.toc) {
      var tp = toc.paras.filter(function (p) { return /\d\s*$/.test(textOf(p)); })[0];
      if (tp && tp.ps !== "ps-hstoc") {
        var was = tp.ps;
        derive(d, "ps-hstoc", was, N.toc, {}, now);
        toc.paras.forEach(function (p) { if (p.ps === was && /\d\s*$/.test(textOf(p))) p.ps = "ps-hstoc"; });
      }
    }
    // the publisher's page: its styles of its own when it is set
    var colMap = {};
    if (book.ty.colophon) colophon(d).forEach(function (st) {
      st.paras.forEach(function (p) {
        if (!colMap[p.ps]) colMap[p.ps] = derive(d, "ps-hscol" + (Object.keys(colMap).length + 1), p.ps, (N.colophon || "colophon") + " " + (Object.keys(colMap).length + 1), {}, now).id;
        p.ps = colMap[p.ps];
      });
    });
    // dedication and motto, each on a right-hand page of its own
    var dedPs = null;
    [["ded", typeof sheet.ded === "string" ? sheet.ded : inf.ded], ["motto", typeof sheet.motto === "string" ? sheet.motto : inf.motto]].forEach(function (x) {
      var txt = String(x[1] || "").trim().slice(0, 2000);
      book[x[0]] = txt;
      if (!txt) return;
      if (!dedPs) dedPs = derive(d, "ps-hsded", body, N.ded, { align: "c", i: 1, fi: 0, sb: 0, ext: { hyph: 0, brk: "any" } }, now).id;
      textPage(d, "front", txt.split(/\n+/).map(function (l) { return { ps: dedPs, runs: [{ t: l }] }; }), { now: now, right: true, low: true });
    });
    // page numbers on the body pages
    var bp = bodyPage(d), pa = A("pn");
    if (bp && pa !== "s") {
      var have = bp.ms ? H.pnItems(d, bp.ms) : [];
      var pnPs = have.length ? M.find(d.stories, have[0].story).paras[0].ps : null;
      var hgt = have.length ? have[0].h : 0;
      // the body pages get a master of their own (the front pages keep theirs)
      if (!bp.ms || d.pages.some(function (p) { return p !== bp && p.ms === bp.ms; })) {
        bp.ms = H.cloneMaster(d, bp.ms, "ms-hsbody" + (bp.ms === "ms-hsbody" ? "2" : ""), { en: "B-Master", el: "B-Master" }, "B", now);
      }
      var gone = {};
      H.pnItems(d, bp.ms).forEach(function (it) { gone[it.id] = 1; gone[it.story] = 1; });
      d.items = d.items.filter(function (it) { return !gone[it.id]; });
      d.stories = d.stories.filter(function (st) { return !gone[st.id]; });
      if (pa !== "none") {
        if (!pnPs || !ps(d, pnPs)) {
          var br = T.resolvePs(T.byId(d.pstyles), body);
          pnPs = derive(d, "ps-hspn", body, N.pn, { align: "c", fi: 0, li: 0, ri: 0, sb: 0, sa: 0, size: br.size, ext: { hyph: 0, brk: "any" } }, now).id;
        }
        var size = T.resolvePs(T.byId(d.pstyles), pnPs).size;
        if (!hgt) hgt = Math.round(size * 2);
        (u.facing ? ["L", "R"] : [""]).forEach(function (sd) {
          var g = pnPlace(d, pa, sd, hgt), sid = M.newId("st");
          d.stories.push({ id: sid, m: stamp(now), paras: [{ ps: pnPs, runs: [{ f: "pn" }] }] });
          var it = { id: M.newId("it"), m: stamp(now), t: "text", pg: bp.ms, x: g.x, y: g.y, w: g.w, h: g.h, story: sid, seq: 1, z: 9000 };
          if (sd) it.side = sd;
          d.items.push(it);
        });
      }
    }
    if (sheet.a.pnStart !== undefined) { u.ext = u.ext || {}; u.ext.pnStart = sheet.a.pnStart; }
    // no numbers where a title opens and on empty pages: a master without them
    var hide = A("pnHide") === "hide" || (A("pnHide") === "s" && h.pn && h.pn.hide);
    if (hide && bp && bp.ms && H.pnItems(d, bp.ms).length) {
      book.openMs = H.cloneMaster(d, bp.ms, "ms-hsopen", { en: "C-Master", el: "C-Master" }, "C", now, function (it) { return !(it.t === "text" && H.pnOnly(M.find(d.stories, it.story))); });
    }
    // typography per part
    var ty = book.ty, sets = {
      body: [body, ro.first], title: [title], part: ["ps-hspart"], toc: ["ps-hstoc"], thanks: ["ps-hsthanks"], links: ["ps-hslinks"], ded: ["ps-hsded"], cap: ["ps-hscap"],
      colophon: Object.keys(colMap).map(function (k) { return colMap[k]; })
    };
    PARTS.forEach(function (k) {
      if (!ty[k]) return;
      sets[k].forEach(function (id) { setLook(d, id && ps(d, id), ty[k]); });
    });
    // hyphenation, widows and orphans on the running text
    [["hyph", { on: { hyph: 1 }, off: { hyph: 0 } }], ["widows", { on: { orph: 2, wid: 2 }, off: { orph: 1, wid: 1 } }]].forEach(function (q) {
      var v = A(q[0]);
      if (v === "s") return;
      [body, ro.first].forEach(function (id) {
        var s = id && ps(d, id);
        if (s) Object.keys(q[1][v]).forEach(function (k) { extOf(s)[k] = q[1][v][k]; });
      });
    });
    var fx = A("fix");
    if (fx !== "s") h.rules.forEach(function (r) { if (r.a && r.a.k === "fix") r.on = fx === "on" ? 1 : 0; });
    d.setup.ext.wmap = H.wmapOf(ro);
    d.setup.ext.book = book;
    return M.normDoc(d);
  }

  // ---------- 4. After the flow ----------
  // → pages that got the master without page numbers (also the pages of
  // pictures, ext.pic)
  function finish(d, L) {
    var book = d.setup.ext && d.setup.ext.book, ms = book && book.openMs;
    if (!ms || !M.find(d.masters, ms)) return 0;
    var h = H.houseOf(d), ro = (h && h.roles) || {}, opens = {};
    [ro.title, "ps-hspart", "ps-hsopen"].forEach(function (id) { if (id) opens[id] = 1; });
    var n = 0, seen = {};
    M.pagesInOrder(d).forEach(function (pg) {
      if (!pg.ext || pg.ext.hs !== "body") return;
      var here = [];
      var cap = function (it) { var st = M.find(d.stories, it.story); return !!st && st.paras.length === 1 && st.paras[0].ps === "ps-hscap"; };
      d.items.filter(function (it) { return it.pg === pg.id && it.t === "text" && !cap(it); }).sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (it) {
        ((L.frames[it.id] || {}).lines || []).forEach(function (ln) { here.push({ st: it.story, p: ln.p }); });
      });
      // the page's first line starts a title (not one carried over)
      var f = here[0], st = f && M.find(d.stories, f.st);
      var opensHere = !!st && !seen[f.st + "|" + f.p] && !!opens[(st.paras[f.p] || {}).ps];
      here.forEach(function (x) { seen[x.st + "|" + x.p] = 1; });
      if (!here.length || opensHere || pg.ext.pic) { pg.ms = ms; n++; }
    });
    return n;
  }

  var api = {
    QUESTIONS: QUESTIONS, AT: AT, PARTS: PARTS, LOOK: LOOK, SIZES: SIZES, SECTION_KEYS: SECTION_KEYS,
    PIC_AT: PIC_AT, pictures: pictures, ans: ans,
    info: info, defaults: defaults, clean: clean, atKey: atKey, mark: mark, prepare: prepare, finish: finish, sectionOf: sectionOf, isPart: isPart
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_INTAKE = api;
})(typeof window !== "undefined" ? window : this);
