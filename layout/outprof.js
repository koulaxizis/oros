// ============================================================
// orOS Layout — output profiles (v1.0.0, LY-OUT, wave L7 E1)
// One document, every edition: a profile says which pages go out,
// in which form (print PDF, e-book PDF, later EPUB) and with which
// ISBN of the book's Publishing title. Stored in the document as
// setup.ext.out = { v: 1, list: [profile] } (R39) only once the
// person changes them; until then defaults() stands in.
//   profile = { id "op-…", n (name ≤ 60), k "print" | "ebook" | "epub",
//               (epub: nf 1 no fonts inside, npl 1 no page-list,
//               fx 1 fixed layout with live text, 2 fixed layout of
//               page pictures; E3),
//               fmt (a Publishing format id, "" = none),
//               blank 0|1 (leave out empty pages), toc 0|1 (leave out
//               the contents pages), drop [page id] (≤ 2000),
//               cover (a Layout Book cover document id, "" = none;
//               e-book only: its front panel is the first page),
//               bleed, marks, spreads 0|1 (print only), q "print" |
//               "screen" (picture resolution) }
// Also here (pure, Node-tested):
//   - lang(doc, pub): the book's language (setup.ext.lang, else the
//     Publishing title's when it is a language code) for /Lang and,
//     later, xml:lang;
//   - level(doc, psId): a paragraph style's heading level 0-3
//     (ps.ext.lvl, inherited; else a guess: Heading 1-3 as named, parts
//     1, chapter titles 2);
//   - headings(doc, L): the headings in reading order with their page;
//   - tocLinks(doc, L, heads): the contents lines and the page each one
//     names (e-book PDF links);
//   - edition(doc, prof, pub): a copy of the document for the profile:
//     the other formats' ISBNs (as written, hyphens kept) and the
//     fields {isbn} {price} become this format's;
//   - pagesFor(doc, prof): the page ids that go out.
// Exposes LY_OUT (browser) or module.exports (Node tests).
// ============================================================
(function (root) {
  "use strict";

  var M;
  if (typeof module !== "undefined" && module.exports) M = require("../designkit/model.js");
  else M = root.orosDK.model;

  var KINDS = ["print", "ebook", "epub"], MAX = 8, MAX_DROP = 2000;
  var ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  var LANG_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;
  // The languages the setup lists first (any BCP 47 code is kept).
  var LANGS = ["el", "en", "de", "fr", "it", "es", "pt", "nl", "ru", "tr", "bg", "ro", "sq", "sr", "uk", "pl", "la", "grc"];

  function bit(v) { return v ? 1 : 0; }
  function str(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, n) : ""; }

  function normOne(p, used) {
    if (!p || typeof p !== "object" || !ID_RE.test(p.id || "") || used[p.id]) return null;
    used[p.id] = 1;
    var k = KINDS.indexOf(p.k) >= 0 ? p.k : "print";
    var o = { id: p.id, n: str(p.n, 60), k: k, fmt: /^[A-Za-z0-9_-]{1,64}$/.test(p.fmt || "") ? p.fmt : "",
              blank: bit(p.blank), toc: bit(p.toc), q: p.q === "screen" ? "screen" : "print" };
    var drop = [], seen = {};
    (Array.isArray(p.drop) ? p.drop : []).forEach(function (id) {
      if (typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !seen[id] && drop.length < MAX_DROP) { seen[id] = 1; drop.push(id); }
    });
    if (drop.length) o.drop = drop.sort();
    if (k === "print") { o.bleed = bit(p.bleed); o.marks = bit(p.marks); o.spreads = bit(p.spreads); }
    else if (typeof p.cover === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.cover)) o.cover = p.cover;
    // EPUB (E2): nf 1 = no fonts inside (the reader's own), npl 1 = no
    // print page numbers (page-list)
    if (k === "epub") { if (p.nf) o.nf = 1; if (p.npl) o.npl = 1; if (p.fx === 1 || p.fx === 2) o.fx = p.fx; }
    return o;
  }
  // The stored list, cleaned (unknown kinds become print, ≤ 8, unique
  // ids); null when nothing usable is stored.
  function norm(v) {
    if (!v || typeof v !== "object" || !Array.isArray(v.list)) return null;
    var used = {}, list = [];
    v.list.forEach(function (p) { var o = list.length < MAX && normOne(p, used); if (o) list.push(o); });
    return list.length ? { v: 1, list: list } : null;
  }

  // What a document starts with: the printer's PDF, the e-book PDF and
  // the EPUB (E2: no empty pages, the contents pages become its nav).
  function defaults() {
    return [
      { id: "op-print", n: "", k: "print", fmt: "", blank: 0, toc: 0, q: "print", bleed: 1, marks: 0, spreads: 0 },
      { id: "op-ebook", n: "", k: "ebook", fmt: "", blank: 1, toc: 0, q: "screen" },
      { id: "op-epub", n: "", k: "epub", fmt: "", blank: 1, toc: 1, q: "screen" }
    ];
  }
  function stored(doc) { return norm(doc && doc.setup && doc.setup.ext && doc.setup.ext.out); }
  function list(doc) { var s = stored(doc); return s ? s.list : defaults(); }
  // Writes the list into setup (a copy of setup.ext); [] / null removes it.
  function save(setup, profiles) {
    var ext = Object.assign({}, setup.ext || {});
    var n = norm({ v: 1, list: profiles || [] });
    if (n) ext.out = n; else delete ext.out;
    if (Object.keys(ext).length) setup.ext = ext; else delete setup.ext;
    return setup;
  }
  function newId(profiles) {
    var n = 1, ids = {};
    (profiles || []).forEach(function (p) { ids[p.id] = 1; });
    while (ids["op-" + n]) n++;
    return "op-" + n;
  }

  // ---------- language ----------
  function okLang(v) { return typeof v === "string" && LANG_RE.test(v) ? v : ""; }
  function lang(doc, pub) {
    var x = doc && doc.setup && doc.setup.ext;
    var own = okLang(x && x.lang);
    if (own) return own;
    var pl = pub && typeof pub.lang === "string" ? pub.lang.trim() : "";
    if (okLang(pl)) return pl;
    var low = pl.toLowerCase();
    // i18n-inline-ok: language names a Publishing title may carry, data
    var NAMES = { "ελληνικά": "el", "greek": "el", "english": "en", "αγγλικά": "en", "deutsch": "de", "german": "de", "γερμανικά": "de",
                  "français": "fr", "french": "fr", "γαλλικά": "fr", "italiano": "it", "italian": "it", "ιταλικά": "it", "español": "es", "spanish": "es", "ισπανικά": "es" };
    return NAMES[low] || (okLang(low) ? low : "");
  }

  // ---------- headings ----------
  function psChain(doc, id) {
    var out = [], seen = {}, cur = M.find(doc.pstyles, id);
    while (cur && !seen[cur.id] && out.length < 16) { seen[cur.id] = 1; out.push(cur); cur = cur.base ? M.find(doc.pstyles, cur.base) : null; }
    return out;
  }
  function own(doc, id, key) {
    var ch = psChain(doc, id);
    for (var i = 0; i < ch.length; i++) if (ch[i].ext && ch[i].ext[key] !== undefined) return ch[i].ext[key];
    return undefined;
  }
  // The level a style asks for (0-3), or undefined when it says nothing.
  function setLevel(doc, id) {
    var v = own(doc, id, "lvl");
    if (v === undefined) return undefined;
    v = Math.floor(Number(v));
    return isFinite(v) ? Math.max(0, Math.min(3, v)) : 0;
  }
  // A guess for a style that says nothing: the house style's parts are
  // 1, its chapter titles (and every style whose titles a running head
  // shows, LY-RH) 2.
  function guessLevel(doc, id) {
    var x = doc.setup && doc.setup.ext, wmap = x && x.wmap, roles = (x && x.house && x.house.roles) || {};
    if (id === "ps-hspart") return 1;
    var seed = /^ps-h([1-3])$/.exec(id);   // the starter styles Heading 1-3
    if (seed) return +seed[1];
    if (id === "ps-hsopen") return 2;
    if ((wmap && wmap.title === id) || roles.title === id) return 2;
    if (own(doc, id, "sec")) return 2;
    return 0;
  }
  function level(doc, id) {
    var v = setLevel(doc, id);
    return v === undefined ? guessLevel(doc, id) : v;
  }

  function paraText(para) {
    return (para.runs || []).map(function (r) { return typeof r.t === "string" ? r.t : ""; }).join("").replace(/\s+/g, " ").trim();
  }
  // Page text frames in reading order: by page, then top to bottom,
  // then left to right.
  function framesInOrder(doc, L) {
    var order = M.pagesInOrder(doc), out = [];
    order.forEach(function (p, pi) {
      M.itemsOn(doc, p.id).filter(function (it) { return it.t === "text" && !it.hide && L.frames[it.id]; })
        .sort(function (a, b) { return a.y - b.y || a.x - b.x || M.cmpStr(a.id, b.id); })
        .forEach(function (it) { out.push({ it: it, pg: p.id, pi: pi }); });
    });
    return out;
  }
  // [{ t, lvl, pg (page id), pi (page index), item, y }]: the first line
  // of every paragraph whose style is a heading (a paragraph seen once).
  function headings(doc, L) {
    var out = [], seen = {}, lv = {};
    framesInOrder(doc, L).forEach(function (f) {
      var st = M.story(doc, f.it.story);
      if (!st || (st.ext && st.ext.hs === "toc")) return;
      L.frames[f.it.id].lines.forEach(function (ln) {
        var key = st.id + ":" + ln.p;
        if (seen[key]) return;
        var para = st.paras[ln.p];
        if (!para) return;
        if (!(para.ps in lv)) lv[para.ps] = level(doc, para.ps);
        if (!lv[para.ps]) return;
        seen[key] = 1;
        var t = paraText(para);
        if (t) out.push({ t: t.slice(0, 300), lvl: lv[para.ps], pg: f.pg, pi: f.pi, item: f.it.id, y: f.it.y + ln.y - ln.h });
      });
    });
    return out;
  }

  // letters and digits only, lower case, no accents: how a contents
  // line and a title are compared
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }
  // The contents lines (a story marked ext.hs "toc", LY-AUTO) as links:
  // [{ pg, x, y, w, h, to (page id) }], each paragraph to the first
  // heading whose text it starts with (the page number at its end is
  // ignored), in order, so two chapters of the same name each find
  // their own.
  function tocLinks(doc, L, heads) {
    var out = [], used = 0;
    var keys = heads.map(function (h) { return fold(h.t); });
    framesInOrder(doc, L).forEach(function (f) {
      var st = M.story(doc, f.it.story);
      if (!st || !st.ext || st.ext.hs !== "toc") return;
      var rects = {};
      L.frames[f.it.id].lines.forEach(function (ln) {
        var r = rects[ln.p], y0 = ln.y - ln.h + (ln.d || 0), y1 = ln.y + (ln.d || 0);
        if (!r) rects[ln.p] = r = { x0: ln.cx0, x1: ln.cx1, y0: y0, y1: y1 };
        r.x0 = Math.min(r.x0, ln.cx0); r.x1 = Math.max(r.x1, ln.cx1); r.y0 = Math.min(r.y0, y0); r.y1 = Math.max(r.y1, y1);
      });
      Object.keys(rects).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
        var k = fold(paraText(st.paras[p] || {}).replace(/[\s.…·_\-–—]*\d+\s*$/, ""));
        if (!k) return;
        var hit = -1;
        for (var i = used; i < keys.length && hit < 0; i++) if (keys[i] && (keys[i] === k || k.indexOf(keys[i]) === 0 || keys[i].indexOf(k) === 0)) hit = i;
        for (var j = 0; j < used && hit < 0; j++) if (keys[j] === k) hit = j;
        if (hit < 0) return;
        if (hit >= used) used = hit + 1;
        var r = rects[p], it = f.it;
        out.push({ pg: f.pg, x: it.x + r.x0, y: it.y + r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, to: heads[hit].pg });
      });
    });
    return out;
  }

  // ---------- pages ----------
  function blankPage(doc, pageId) {
    return !M.itemsOn(doc, pageId).some(function (it) {
      if (it.hide) return false;
      if (it.t === "text") { var st = M.story(doc, it.story); return !!(st && st.paras.some(function (p) { return paraText(p); })); }
      return true;
    });
  }
  function tocPage(doc, pageId) {
    return M.itemsOn(doc, pageId).some(function (it) {
      var st = it.t === "text" && M.story(doc, it.story);
      return !!(st && st.ext && st.ext.hs === "toc");
    });
  }
  // A text frame with text in it shows on the page only through the
  // layout; an empty frame or a page of only master items is blank.
  function pagesFor(doc, prof) {
    var drop = {};
    (prof.drop || []).forEach(function (id) { drop[id] = 1; });
    return M.pagesInOrder(doc).filter(function (p) {
      if (drop[p.id]) return false;
      if (prof.blank && blankPage(doc, p.id)) return false;
      if (prof.toc && tocPage(doc, p.id)) return false;
      return true;
    }).map(function (p) { return p.id; });
  }

  // ---------- the book's details from Publishing ----------
  // The Publishing title the document belongs to (setup.ext.pub), from
  // the app's data (read only), or null.
  function pubOf(doc, data) {
    var id = doc && doc.setup && doc.setup.ext && doc.setup.ext.pub;
    if (typeof id !== "string" || !data || !Array.isArray(data.titles)) return null;
    var tombs = data.tombs || {};
    return data.titles.filter(function (x) { return x && x.id === id && !(tombs[x.id] >= x.m); })[0] || null;
  }
  // The format a profile takes its ISBN from: its own, else the first
  // of the right kind (print: paperback, then hardback; e-book: eb).
  function formatOf(prof, pub) {
    var fm = pub && Array.isArray(pub.fmts) ? pub.fmts.filter(Boolean) : [];
    var f = prof.fmt ? fm.filter(function (x) { return x.id === prof.fmt; })[0] : null;
    if (f) return f;
    var kinds = prof.k === "print" ? ["pb", "hb"] : ["eb"];
    for (var i = 0; i < kinds.length; i++) {
      f = fm.filter(function (x) { return x.k === kinds[i] && x.isbn; })[0];
      if (f) return f;
    }
    return null;
  }
  function priceText(f, cur) {
    if (!f || !(f.price > 0)) return "";
    var v = (Math.round(f.price * 100) / 100).toFixed(2);
    return cur === "EUR" || !cur ? v.replace(".", ",") + " €" : v + " " + cur;
  }
  // "9786185321005" written as it stands in the text ("978-618-5321-00-5",
  // "978 618 …"): a pattern of its digits with optional - or space.
  function isbnPattern(digits) {
    return new RegExp(digits.split("").join("[-\\u2010\\u2011\\u2013 ]?"), "g");
  }
  // The new ISBN in the old one's shape (same groups: one publisher's
  // numbers share the prefix, so the hyphens fall in the same places).
  function shaped(old, digits) {
    var out = "", k = 0;
    for (var i = 0; i < old.length; i++) {
      if (/\d|X/i.test(old[i])) out += digits[k++] || "";
      else out += old[i];
    }
    return out + digits.slice(k);
  }
  // The book's own words for the line (content in the book's language,
  // not the interface's).
  function printLabel(lg) {
    var k = String(lg || "").split("-")[0];
    // i18n-inline-ok: text that goes into the book, in the book's language
    var L = { el: "ISBN έντυπης έκδοσης: ", de: "ISBN der Druckausgabe: ", fr: "ISBN de l’édition imprimée : ", it: "ISBN dell’edizione cartacea: ", es: "ISBN de la edición impresa: " };
    return L[k] || "Print edition ISBN: ";
  }
  // A copy of the document for the profile ({ doc, changed }); the
  // original is never touched. data: the Publishing app's data or null.
  function edition(doc, prof, data) {
    var pub = pubOf(doc, data), f = formatOf(prof, pub);
    var isbn = f && /^\d{13}$/.test(f.isbn || "") ? f.isbn : "";
    var price = priceText(f, data && data.set && data.set.cur);
    var others = [];
    if (pub && isbn) (pub.fmts || []).forEach(function (x) { if (x && /^\d{13}$/.test(x.isbn || "") && x.isbn !== isbn) others.push(x.isbn); });
    // the print edition's number, for the e-book's "Print edition ISBN"
    // line (only an e-book replaces it)
    var printIsbn = "";
    if (pub && isbn && prof.k !== "print") (pub.fmts || []).forEach(function (x) {
      if (!printIsbn && x && (x.k === "pb" || x.k === "hb") && /^\d{13}$/.test(x.isbn || "") && x.isbn !== isbn) printIsbn = x.isbn;
    });
    var d = JSON.parse(JSON.stringify(doc)), changed = 0, lineAdded = false;
    d.stories.forEach(function (st) {
      for (var pi = 0; pi < st.paras.length; pi++) {
        var p = st.paras[pi], printShape = "";
        (p.runs || []).forEach(function (r) {
          if (typeof r.t !== "string" || !r.t) return;
          var t0 = r.t, t1 = t0;
          if (printIsbn && !printShape) { var mm = t0.match(isbnPattern(printIsbn)); if (mm) printShape = mm[0]; }
          others.forEach(function (o) { t1 = t1.replace(isbnPattern(o), function (m) { return shaped(m, isbn); }); });
          if (isbn) t1 = t1.replace(/\{isbn\}/gi, isbn);
          if (price) t1 = t1.replace(/\{(price|τιμή)\}/gi, price);
          if (t1 !== t0) { r.t = t1; changed++; }
        });
        if (printShape && !lineAdded) {
          // the same style as the ISBN line, right after it
          lineAdded = true;
          st.paras.splice(pi + 1, 0, { ps: p.ps, runs: [{ t: printLabel(lang(doc, pub)) + printShape }] });
          changed++; pi++;
        }
      }
    });
    return { doc: d, changed: changed, isbn: isbn, fmt: f, pub: pub, printIsbn: printIsbn };
  }

  var api = {
    KINDS: KINDS, MAX: MAX, LANGS: LANGS, norm: norm, defaults: defaults, stored: stored, list: list, save: save, newId: newId,
    okLang: okLang, lang: lang, setLevel: setLevel, guessLevel: guessLevel, level: level, headings: headings, tocLinks: tocLinks,
    pagesFor: pagesFor, blankPage: blankPage, tocPage: tocPage, pubOf: pubOf, formatOf: formatOf, edition: edition, fold: fold,
    framesInOrder: framesInOrder, paraText: paraText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_OUT = api;
})(typeof window !== "undefined" ? window : this);
