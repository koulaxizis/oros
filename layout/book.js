// ============================================================
// orOS Layout — books (LY-W7)
// A book is a list of documents (chapters, front matter, back matter)
// that belong together: each one's setup.ext.bk { id, name, n (its
// place) } names the book, so the book travels with its documents and
// syncs like them. From the Book dialog (More › Book…):
//   - pages numbered on through the book (each document's first page
//     number, setup.ext.pnStart, follows the one before; chapters on a
//     right-hand page when asked);
//   - styles and colours made the same as the first document's;
//   - one PDF of the whole book.
// Pure part (Node tests): bookOf, members, numbering, syncStyles.
// ============================================================
(function (root) {
  "use strict";

  var M = typeof module !== "undefined" && module.exports ? require("../designkit/model.js") : root.orosDK.model;
  var BK_ID = /^bk-[a-z0-9]{1,24}$/;

  function bookOf(doc) {
    var b = doc && doc.setup && doc.setup.ext && doc.setup.ext.bk;
    if (!b || typeof b !== "object" || !BK_ID.test(String(b.id))) return null;
    return { id: b.id, name: String(b.name || "").slice(0, 120), n: Number(b.n) || 0 };
  }
  // the documents of a book, in their order
  function members(docs, id) {
    return docs.filter(function (d) { var b = bookOf(d); return b && b.id === id; })
      .sort(function (a, b) { return bookOf(a).n - bookOf(b).n || M.cmpStr(a.name || "", b.name || "") || M.cmpStr(a.id, b.id); });
  }
  // each document's first page number: the first keeps its own, the
  // next follow on; odd: a document starts on an odd (right-hand) number
  function numbering(list, odd) {
    var out = [], next = null;
    list.forEach(function (d) {
      var start = next === null ? M.firstNumber(d) : next;
      if (odd && next !== null && start % 2 === 0) start++;
      out.push({ id: d.id, start: start, pages: M.pagesInOrder(d).length });
      next = start + M.pagesInOrder(d).length;
    });
    return out;
  }
  // dst's paragraph and character styles and colours made as src's: the
  // same id takes src's version, the ones dst lacks are added, its own
  // others stay. → the number changed or added
  function syncStyles(src, dst, now) {
    var n = 0;
    ["swatches", "pstyles", "cstyles"].forEach(function (k) {
      var have = {};
      (dst[k] || []).forEach(function (x, i) { have[x.id] = i; });
      (src[k] || []).forEach(function (x) {
        var c = JSON.parse(JSON.stringify(x));
        if (have[x.id] !== undefined) {
          var cur = dst[k][have[x.id]];
          var a = JSON.parse(JSON.stringify(cur)), b = JSON.parse(JSON.stringify(c));
          delete a.m; delete b.m;
          if (JSON.stringify(a) === JSON.stringify(b)) return;
          c.m = now; dst[k][have[x.id]] = c;
        } else { c.m = now; dst[k].push(c); }
        n++;
      });
    });
    return n;
  }
  function newBookId() { return "bk-" + Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, ""); }

  var api = { bookOf: bookOf, members: members, numbering: numbering, syncStyles: syncStyles, newBookId: newBookId };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.LY_BOOK = api;

  // ---------- the dialog (browser) ----------
  var LY = root.LY;
  if (!LY) return;
  var t = LY.t, el = LY.el;

  function allDocs() { return LY.allDocs ? LY.allDocs() : [LY.doc]; }
  function setBk(d, bk, now) {
    var x = d.setup.ext ? JSON.parse(JSON.stringify(d.setup.ext)) : {};
    if (bk) x.bk = bk; else delete x.bk;
    d.setup.ext = Object.keys(x).length ? x : undefined;
    if (!d.setup.ext) delete d.setup.ext;
    M.touch(d, now);
  }
  // a change to one document of the book: the open one as an undo step,
  // the others as stored copies
  function change(id, fn) {
    if (LY.doc && LY.doc.id === id) { LY.op(function (doc, now) { return fn(doc, now); }); return true; }
    var d = LY.findDoc(id);
    if (!d) return false;
    var copy = JSON.parse(JSON.stringify(d));
    if (fn(copy, LY.now()) === false) return true;
    return LY.putDoc(copy);
  }

  function open() {
    var doc = LY.doc;
    if (!doc) return;
    if (LY.flushStory) LY.flushStory();
    var bk = bookOf(doc);
    LY.openDialog(t("book.title"), function (body, close) {
      function again() { close(); open(); }
      if (!bk) {
        body.appendChild(el("p", "hint", t("book.none")));
        var nm = el("input", "inp");
        nm.type = "text"; nm.maxLength = 120; nm.value = doc.name || "";
        nm.setAttribute("aria-label", t("book.name"));
        body.appendChild(LY.ui.field(t("book.name"), nm, "block"));
        var act0 = el("div", "dlg-actions");
        act0.appendChild(el("span", "spacer"));
        act0.appendChild(LY.ui.btn(t("btn.cancel"), close));
        act0.appendChild(LY.ui.btn(t("book.make"), function () {
          var name = nm.value.trim().slice(0, 120) || t("book.title");
          change(doc.id, function (d, now) { setBk(d, { id: newBookId(), name: name, n: 0 }, now); });
          again();
        }, "primary"));
        body.appendChild(act0);
        return;
      }
      var list = members(allDocs(), bk.id);
      body.appendChild(el("p", "book-name", bk.name || t("book.title")));
      var nums = numbering(list, false), ol = el("ol", "book-list");
      list.forEach(function (d, i) {
        var li = el("li", "book-item" + (d.id === doc.id ? " here" : ""));
        li.appendChild(el("span", "book-doc", (d.name || t("doc.untitled")) + "  ·  " + t("book.pages", { a: M.firstNumber(d), b: M.firstNumber(d) + nums[i].pages - 1 })));
        var up = LY.ui.btn("↑", function () { move(list, i, -1); again(); }, "small ghost");
        up.disabled = i === 0; up.setAttribute("aria-label", t("book.up")); up.title = t("book.up");
        var dn = LY.ui.btn("↓", function () { move(list, i, 1); again(); }, "small ghost");
        dn.disabled = i === list.length - 1; dn.setAttribute("aria-label", t("book.down")); dn.title = t("book.down");
        var rm = LY.ui.btn("✕", function () { change(d.id, function (x, now) { setBk(x, null, now); }); again(); }, "small ghost");
        rm.setAttribute("aria-label", t("book.remove")); rm.title = t("book.remove");
        li.appendChild(up); li.appendChild(dn); li.appendChild(rm);
        ol.appendChild(li);
      });
      body.appendChild(ol);
      // documents not in a book yet
      var free = allDocs().filter(function (d) { return !bookOf(d) && !M.needsNewer(d); });
      if (free.length) {
        var pick = LY.ui.select([["", t("book.addPick")]].concat(free.map(function (d) { return [d.id, d.name || t("doc.untitled")]; })), "", function (v) {
          if (!v) return;
          var last = list.length ? bookOf(list[list.length - 1]).n : 0;
          change(v, function (d, now) { setBk(d, { id: bk.id, name: bk.name, n: last + 1 }, now); });
          again();
        });
        pick.setAttribute("aria-label", t("book.add"));
        body.appendChild(LY.ui.field(t("book.add"), pick, "block"));
      }
      var odd = 0;
      body.appendChild(LY.ui.check(t("book.odd"), odd, function (v) { odd = v; }));
      var row = el("div", "pn-row wrap");
      row.appendChild(LY.ui.btn(t("book.number"), function () {
        var n = 0;
        numbering(list, !!odd).forEach(function (x) {
          change(x.id, function (d, now) {
            if (M.firstNumber(d) === x.start) return false;
            var e = d.setup.ext ? JSON.parse(JSON.stringify(d.setup.ext)) : {};
            e.pnStart = x.start; d.setup.ext = e; M.touch(d, now); n++;
          });
        });
        LY.toast(t("book.numbered", { n: n }));
        again();
      }, "small"));
      var sy = LY.ui.btn(t("book.sync"), function () {
        var src = list[0], n = 0;
        list.slice(1).forEach(function (d) {
          change(d.id, function (x, now) { var k = syncStyles(src, x, now); n += k; return k ? undefined : false; });
        });
        LY.toast(t("book.synced", { n: n }));
      }, "small");
      sy.disabled = list.length < 2;
      row.appendChild(sy);
      row.appendChild(LY.ui.btn(t("book.pdf"), function () { close(); bookPdf(bk, list); }, "small primary"));
      body.appendChild(row);
      body.appendChild(el("p", "hint", t("book.hint")));
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(LY.ui.btn(t("btn.close"), close));
      body.appendChild(act);
    }, true);
  }
  function move(list, i, d) {
    var j = i + d;
    if (j < 0 || j >= list.length) return;
    var a = list[i], b = list[j];
    list[i] = b; list[j] = a;
    list.forEach(function (x, k) {
      var cur = bookOf(x);
      if (cur.n !== k) change(x.id, function (y, now) { setBk(y, { id: cur.id, name: cur.name, n: k }, now); });
    });
  }
  // the whole book as one screen PDF, each document in its turn
  function bookPdf(bk, list) {
    LY.toast(t("book.making"));
    var parts = [];
    var chain = Promise.resolve();
    list.forEach(function (d) {
      chain = chain.then(function () {
        var L = d === LY.doc && LY.ed && LY.ed.L ? LY.ed.L : LY.R.computeLayout(d);
        var opts = { layout: L, ppi: 150, rgb: true };
        if (root.LY_OUT && root.LY_OUT.urlLinks) opts.links = root.LY_OUT.urlLinks(d, L);
        return LY.io.pdfDoc(d, opts).then(function (pdf) { parts.push(new Uint8Array(pdf.output("arraybuffer"))); });
      });
    });
    chain.then(function () { return LY.io.script("../vendor/pdf-lib/pdf-lib.min.js", "PDFLib"); }).then(function (P) {
      return P.PDFDocument.create().then(function (out) {
        var c = Promise.resolve();
        parts.forEach(function (bytes) {
          c = c.then(function () { return P.PDFDocument.load(bytes); }).then(function (src) {
            return out.copyPages(src, src.getPageIndices()).then(function (pages) { pages.forEach(function (p) { out.addPage(p); }); });
          });
        });
        return c.then(function () { out.setTitle(bk.name || t("book.title")); return out.save(); });
      });
    }).then(function (bytes) {
      var blob = new Blob([bytes], { type: "application/pdf" });
      return LY.io.saveBlob(blob, (bk.name || t("book.title")).replace(/[\\\/:*?"<>|]+/g, " ").trim() + ".pdf", "application/pdf", "PDF", ".pdf");
    }).then(function () { LY.toast(t("book.made")); }, function () { LY.toast(t("book.failed")); });
  }

  LY.book = { open: open };
})(typeof window !== "undefined" ? window : this);
