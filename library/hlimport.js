// ============================================================
// orOS Library — Import highlights (UI)
// More › Import highlights…: Kindle "My Clippings.txt", KOReader
// (JSON / Markdown) or Readwise CSV → highlights, notes and bookmarks
// of the books already in the library.
// Parsing, matching and placing are pure (import.js,
// OrosLibraryImport); here: pick → read each matched book's text
// (EPUB chapters / PDF pages, the same text the reader counts in) →
// preview → ONE commit (one sync mark) → toast with Undo.
// Nothing from the file is ever inserted as HTML (textContent only).
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el;
  var ACCEPT = ".txt,.json,.md,.markdown,.csv,text/plain,application/json,text/markdown,text/csv";
  var SRC = { kindle: "Kindle (My Clippings.txt)", koreader: "KOReader (JSON)", "koreader-md": "KOReader (Markdown)", readwise: "Readwise (CSV)" };
  var MAX_PAGES = 3000;              // PDF pages read for their text
  var SHOW = 50;                     // rows listed in the preview

  function I() { return window.OrosLibraryImport; }

  function localPick(accept) {
    return new Promise(function (resolve) {
      var i = el("input");
      i.type = "file";
      i.accept = accept;
      i.addEventListener("change", function () { resolve(i.files && i.files[0] ? i.files[0] : null); });
      i.click();
    });
  }

  function start() {
    var KIT = window.OrosImportKit;
    if (!I() || !KIT) return;
    var p = LIB.parentWin(), dlg = p && p.orosDialog;
    var pick = dlg && typeof dlg.openFile === "function" ? dlg.openFile(ACCEPT) : localPick(ACCEPT);
    Promise.resolve(pick).then(function (file) {
      if (!file) return null;                  // cancel = silent exit
      return KIT.readFile(file, I().MAX_FILE).then(function (f) { return I().readBytes(f.bytes, f.name); });
    }).then(function (res) {
      if (!res) return null;
      if (res.error) { LIB.toast(t(res.error === "big" ? "hi.big" : res.error === "empty" ? "hi.empty" : "hi.bad")); return null; }
      return prepare(res);
    }).catch(function (e) {
      LIB.busy(false);
      LIB.toast(t(e && e.message === "toobig" ? "hi.big" : "hi.bad"));
    });
  }

  // ---------- The books' own text ----------
  // EPUB (and FB2 / comics, built in memory): every spine file through
  // sanitize.js, as the reader does (pictures count as present, so an
  // alt text never shifts the offsets); PDF: every page's text items.
  function epubTexts(bytes, book, path) {
    var S = window.LibSanitize;
    return LIB.store.openEpub(bytes, book.kind, path).then(function (e) {
      var zip = e.zip, pkg = e.pkg, lower = {};
      zip.names.forEach(function (n) { lower[n.toLowerCase()] = n; });
      function real(p) { return !p ? null : zip.has(p) ? p : (lower[p.toLowerCase()] || null); }
      function res(p) {
        var n = real(p);
        if (!n) return "";
        var it = pkg.items && pkg.byPath ? pkg.items[pkg.byPath[n]] : null;
        return (it && /^image\//.test(it.type || "")) || /\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i.test(n) ? "blob:x" : "";
      }
      var out = [], spine = pkg.spine || [], i = 0;
      function next() {
        if (i >= spine.length) return out;
        var n = real(spine[i++].path);
        if (!n) { out.push(""); return next(); }
        return zip.text(n, 16 * 1024 * 1024).then(function (src) {
          var prep = S.prepare(src || "", n);
          out.push(S.textOf(S.build(prep, n, res)).text);
        }, function () { out.push(""); }).then(next);
      }
      return next();
    });
  }
  function pdfTexts(bytes) {
    return LIB.store.openPdf(bytes).then(function (pdf) {
      var out = [], n = Math.min(pdf.numPages, MAX_PAGES), i = 0;
      function next() {
        if (i >= n) return out;
        return pdf.getPage(++i).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var s = "";
          (tc.items || []).forEach(function (it) { if (typeof it.str === "string") s += it.str + (it.hasEOL ? "\n" : ""); });
          out.push(s);
        }, function () { out.push(""); }).then(next);
      }
      return next().then(function (r) { try { pdf.destroy(); } catch (e) {} return r; });
    });
  }
  // → Promise of [string] or null (file not on this device / unreadable)
  function textsOf(book) {
    return LIB.store.pathOf(book).then(function (path) {
      if (!path) return null;
      return LIB.store.readBytes(path).then(function (bytes) {
        return book.fmt === "pdf" ? pdfTexts(bytes) : epubTexts(bytes, book, path);
      });
    }).catch(function () { return null; });
  }

  // ---------- Match + place ----------
  function prepare(res) {
    var groups = {}, order = [], missing = [];
    res.books.forEach(function (src) {
      var b = I().matchBook(src, LIB.data.books);
      if (!b) { missing.push(src); return; }
      if (!groups[b.id]) { groups[b.id] = { book: b, src: { title: src.title, author: src.author, items: [] } }; order.push(b.id); }
      groups[b.id].src.items = groups[b.id].src.items.concat(src.items);
    });
    var list = order.map(function (id) { return groups[id]; });
    LIB.busy(true, t("hi.busy"));
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve();
      var g = list[i++];
      return textsOf(g.book).then(function (tx) { g.texts = tx; g.cache = {}; }).then(next);
    }
    return next().then(function () {
      LIB.busy(false);
      preview(res, list, missing);
    });
  }
  function planAll(list) {
    return list.map(function (g) {
      var book = LIB.book(g.book.id) || g.book;
      return { g: g, book: book, p: I().planBook(g.src, book, { texts: g.texts, fmt: book.fmt, marks: LIB.data.marks, cache: g.cache }) };
    });
  }

  // ---------- Preview ----------
  function preview(res, list, missing) {
    var plans = planAll(list), nAdd = 0, nItems = 0;
    plans.forEach(function (x) { nAdd += x.p.add.length; });
    res.books.forEach(function (b) { nItems += b.items.length; });
    var dlg = LIB.dialog("lb-hlimp", t("hi.title"), "wide");
    var body = el("div", "hi-body");
    function para(text, cls) { var p = el("p", cls || "hint", text); body.appendChild(p); return p; }
    para(t("hi.src", { s: SRC[res.source] || res.source }), "hi-src");
    para(t("hi.file", { b: LIB.num(res.books.length), n: LIB.num(nItems) }));
    var rg = I().dateRange(res);
    if (rg) para(t("hi.range", { a: LIB.date(rg.from), b: LIB.date(rg.to) }));
    para(t("hi.map"));
    if (plans.length) {
      body.appendChild(el("h3", "hi-h", t("hi.books")));
      var ul = el("ul", "hi-list");
      plans.slice(0, SHOW).forEach(function (x) {
        var li = el("li");
        li.appendChild(el("b", "", x.book.title));
        var bits = [], p = x.p;
        var hl = p.add.length - p.page;
        bits.push(t("hi.add", { n: LIB.num(hl) }));
        if (p.page) bits.push(t("hi.page", { n: LIB.num(p.page) }));
        if (p.have) bits.push(t("hi.have", { n: LIB.num(p.have) }));
        if (p.nopos) bits.push(t("hi.nopos", { n: LIB.num(p.nopos) }));
        if (p.nofile) bits.push(t("hi.nofile", { n: LIB.num(p.nofile) }));
        li.appendChild(el("span", "hi-meta", bits.join(" · ")));
        ul.appendChild(li);
      });
      if (plans.length > SHOW) ul.appendChild(el("li", "hint", t("hi.more", { n: LIB.num(plans.length - SHOW) })));
      body.appendChild(ul);
    }
    if (missing.length) {
      body.appendChild(el("h3", "hi-h", t("hi.missing")));
      var ml = el("ul", "hi-list hi-miss");
      missing.slice(0, SHOW).forEach(function (s) {
        var li = el("li");
        li.appendChild(el("b", "", s.title));
        if (s.author) li.appendChild(el("span", "hi-meta", s.author));
        ml.appendChild(li);
      });
      if (missing.length > SHOW) ml.appendChild(el("li", "hint", t("hi.more", { n: LIB.num(missing.length - SHOW) })));
      body.appendChild(ml);
      para(t("hi.missingHint"));
    }
    para(nAdd ? t("hi.keep") : t("hi.none"));
    para(t("hi.priv"), "hint hi-priv");
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    acts.appendChild(LIB.textBtn("btn", t("btn.cancel"), function () { dlg.close(); }));
    if (nAdd) {
      var go = LIB.textBtn("btn primary", t("hi.go"), function () {
        dlg.close();
        // planned again on the data as it is NOW (a pull may have
        // landed while the preview was open)
        apply(planAll(list));
      });
      go.id = "hi-go";
      acts.appendChild(go);
    }
    dlg.appendChild(acts);
    dlg.showModal();
  }

  // ---------- Write + Undo ----------
  // ONE commit: every new mark stamped above any tombstone of its id
  // (an import undone before can come back), merged by core.js like
  // any mark; the person's own marks are never touched.
  function apply(plans) {
    var added = [];
    plans.forEach(function (x) {
      x.p.add.forEach(function (rec) {
        if (LIB.mark(rec.id)) return;
        var n = C.normMark(Object.assign({}, rec, { m: LIB.now(LIB.data.tombs[rec.id] || 0) }));
        if (!n) return;
        LIB.data.marks.push(n);
        added.push({ id: n.id, m: n.m });
      });
    });
    if (!added.length) { LIB.toast(t("hi.none")); return; }
    LIB.commit();
    if (LIB.reader) LIB.reader.marksChanged();
    LIB.undoToast(t("hi.done", { n: LIB.num(added.length) }), function () { undo(added); });
  }
  // Undo works on the CURRENT data: each imported mark the person has
  // not changed since (same stamp) gets a newer tombstone, so a device
  // that already pulled it drops it too. Edited ones stay.
  function undo(added) {
    added.forEach(function (x) {
      var k = LIB.mark(x.id);
      if (!k || k.m !== x.m) return;
      LIB.data.tombs[x.id] = LIB.now(Math.max(k.m, LIB.data.tombs[x.id] || 0));
    });
    LIB.commit();
    if (LIB.reader) LIB.reader.marksChanged();
    LIB.toast(t("hi.undone"));
  }

  LIB.hlImport = { start: start };
})();
