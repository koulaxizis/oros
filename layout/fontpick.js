// ============================================================
// orOS Layout — fontpick.js: the Fonts dialog (wave LY-FONT)
// Picks a family for a style (designkit/fonts.js):
//   - "On this device": the font files on the orOS disk
//     (/internal/Fonts, synced like any file), grouped by family, and
//     `Add a font file…` (TTF, OTF with TrueType outlines, WOFF), each
//     file checked before it is kept;
//   - "Free fonts": the Fontsource catalog, searched on this device
//     once the list is here (first time online), Greek-capable ones
//     on request;
//   - "Collections" (FM-2, made in Settings › Fonts, synced slice
//     "fonts"): the document's collection (setup.ext.col) first, then
//     the others, and the choice of the document's collection.
// LY.fonts.pick(done, cancel): done(entry) with { id, name, fb, r?,
// b?, i?, bi? } for setup.ext.fonts; nothing is written here.
// LY.fonts.add(entry): the entry into the open document's list.
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, F = LY.F, t = LY.t, el = LY.el;
  var SHOWN = 60;
  var st = { q: "", greek: LY.LANG === "el" };
  var C = F.cols, CB = C ? C.bind(window, null) : null;     // the "fonts" slice

  function variants(f) {
    // a family of one bold file lists it as its regular face too: say bold
    return ["r", "b", "i", "bi"].filter(function (v) {
      return f[v] && !(v === "r" && [f.b, f.i, f.bi].indexOf(f.r) >= 0);
    }).map(function (v) { return t("fp.v." + v); }).join(", ");
  }

  function pick(done, cancel) {
    var U = LY.ui, dlg = LY.$("dlg");
    // Cancel, Esc or a click outside: back to where the dialog came from.
    // (A close event of the dialog this one replaced may still be on
    // its way: it finds the dialog open and is ignored.)
    function onClose() {
      if (dlg.open) return;
      dlg.removeEventListener("close", onClose);
      if (cancel) cancel();
    }
    LY.openDialog(t("fp.title"), function (body, close) {
      // collections (FM-2)
      var s0 = CB && C.order(CB.get(), LY.LANG).length ? el("section", "pn-sec") : null;
      if (s0) body.appendChild(s0);
      // on this device
      var s1 = el("section", "pn-sec");
      s1.appendChild(el("h3", "pn-h", t("fp.mine")));
      var mine = el("div", "fp-list");
      mine.appendChild(el("p", "hint", t("fp.loading")));
      s1.appendChild(mine);
      var file = el("input");
      file.type = "file"; file.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"; file.hidden = true;
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        file.value = "";
        if (!f) return;
        F.importFile(f).then(function (rec) {
          if (rec.err) { LY.toast(t("fp.err." + rec.err)); return; }
          LY.toast(t("fp.added", { name: rec.family }));
          drawMine();
        });
      });
      s1.appendChild(file);
      s1.appendChild(U.btn(t("fp.add"), function () { file.click(); }, "small"));
      s1.appendChild(el("p", "hint", t("fp.addHint")));
      body.appendChild(s1);

      function row(name, sub, entry) {
        var b = el("button", "fp-row");
        b.type = "button";
        b.appendChild(el("span", "fp-name", name));
        if (sub) b.appendChild(el("span", "fp-sub", sub));
        b.addEventListener("click", function () { dlg.removeEventListener("close", onClose); close(); done(entry); });
        return b;
      }
      function drawCols(fams) {
        if (!s0) return;
        s0.innerHTML = "";
        var d = CB.get(), ids = C.order(d, LY.LANG), dc = C.docCol(LY.doc, d);
        s0.appendChild(el("h3", "pn-h", t("fp.cols")));
        var sel = el("select", "inp");
        sel.setAttribute("aria-label", t("fp.docCol"));
        [["", t("fp.docCol.none")]].concat(ids.map(function (c) { return [c, d.cols[c].name]; })).forEach(function (o) {
          var op = el("option", null, o[1]);
          op.value = o[0];
          if (o[0] === dc) op.selected = true;
          sel.appendChild(op);
        });
        sel.addEventListener("change", function () { setDocCol(sel.value); drawCols(fams); });
        var lab = el("label", "fp-col");
        lab.appendChild(el("span", "hint", t("fp.docCol")));
        lab.appendChild(sel);
        s0.appendChild(lab);
        var byId = {};
        fams.forEach(function (f) { byId[f.id] = f; });
        (dc ? [dc] : []).concat(ids.filter(function (c) { return c !== dc; })).forEach(function (cid) {
          var list = C.fams(d, cid, LY.LANG);
          if (!list.length) return;
          s0.appendChild(el("h4", "fp-colh", d.cols[cid].name));
          var box = el("div", "fp-list");
          list.forEach(function (x) {
            if (x.id.indexOf("fs_") === 0) { box.appendChild(row(x.name, "", { id: x.id, name: x.name, fb: x.fb })); return; }
            var f = byId[x.id];
            if (f) { box.appendChild(row(f.name, variants(f), f)); return; }
            var b = row(x.name, t("fp.notHere"), null);
            b.disabled = true;
            box.appendChild(b);
          });
          s0.appendChild(box);
        });
      }
      function drawMine() {
        F.library().then(function (lib) {
          mine.innerHTML = "";
          var fams = F.families(lib);
          drawCols(fams);
          if (!fams.length) mine.appendChild(el("p", "hint", t("fp.none")));
          fams.forEach(function (f) { mine.appendChild(row(f.name, variants(f), f)); });
        });
      }
      drawMine();

      // free fonts
      var s2 = el("section", "pn-sec");
      s2.appendChild(el("h3", "pn-h", t("fp.free")));
      var q = el("input", "inp");
      q.type = "search"; q.placeholder = t("fp.search"); q.maxLength = 60; q.value = st.q;
      q.setAttribute("aria-label", t("fp.search"));
      s2.appendChild(q);
      s2.appendChild(U.check(t("fp.greek"), st.greek, function (v) { st.greek = v; drawFree(); }));
      var free = el("div", "fp-list");
      s2.appendChild(free);
      body.appendChild(s2);
      var timer = 0;
      q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { st.q = q.value.trim(); drawFree(); }, 200); });
      function drawFree() {
        free.innerHTML = "";
        free.appendChild(el("p", "hint", t("fp.loading")));
        F.catalog().then(function (cat) {
          free.innerHTML = "";
          if (!cat.length) { free.appendChild(el("p", "hint", t("fp.offline"))); return; }
          var k = F.squash(st.q);
          var hits = cat.filter(function (c) { return (!st.greek || c.greek) && (!k || F.squash(c.family).indexOf(k) >= 0); });
          if (!hits.length) free.appendChild(el("p", "hint", t("fp.noMatch")));
          hits.slice(0, SHOWN).forEach(function (c) {
            free.appendChild(row(c.family, c.greek ? t("fp.hasGreek") : "", { id: c.id, name: c.family, fb: c.cat }));
          });
          if (hits.length > SHOWN) free.appendChild(el("p", "hint", t("fp.moreHits", { n: hits.length - SHOWN })));
        });
      }
      drawFree();

      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(U.btn(t("btn.cancel"), close));
      body.appendChild(act);
    }, true);
    dlg.addEventListener("close", onClose);
  }

  // The family into the open document's list (its name and files, so
  // every device knows them).
  function add(entry) {
    LY.op(function (doc, now) {
      var s = JSON.parse(JSON.stringify(doc.setup));
      s.ext = s.ext || {};
      s.ext.fonts = F.withEntry(F.docFonts(doc), entry);
      doc.setup = LY.M.normSetup(s);
      doc.m = Math.max(now, doc.m + 1);
    });
  }

  // The document's collection (setup.ext.col; "" = none).
  function setDocCol(cid) {
    if (cid && !(CB && CB.get().cols[cid])) return;
    LY.op(function (doc, now) {
      var s = JSON.parse(JSON.stringify(doc.setup));
      s.ext = s.ext || {};
      if ((s.ext.col || "") === cid) return false;
      if (cid) s.ext.col = cid; else delete s.ext.col;
      doc.setup = LY.M.normSetup(s);
      doc.m = Math.max(now, doc.m + 1);
    });
  }

  LY.fonts = { pick: pick, add: add, setDocCol: setDocCol };
})();
