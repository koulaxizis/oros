// ============================================================
// orOS Layout — cover.js: the Book cover dialog (publisher wave P3)
// Trim size, pages and paper → the spine (the printer's figure can
// be typed over it), flaps, bleed, the book's texts, the ISBN and a
// front picture → one new document built by designkit/cover.js
// (back · spine · front on one page, fold guides, vector barcode).
//   - the picture comes from the device or from the orOS disk (the
//     deep link { cover: { img: "/internal/…" } }, only under
//     /internal/); it is stored as a normal asset (assets.js)
//   - LY.cover.open(prefill): prefill { title, sub, author, blurb,
//     imprint, isbn, isbnShown, price, pages, w, h, spine, img, logo }
//     from Publishing or the Assistant; every field stays editable
//   - nothing is saved until Create
// ============================================================
(function () {
  "use strict";

  var LY = window.LY, A = LY.A, t = LY.t, el = LY.el;
  var CV = window.orosDK.cover;
  var IMG_EXT = /\.(png|jpe?g|webp|gif)$/i, IMG_MAX = 50 * 1024 * 1024;

  // device-local, session only (R10): the last size and paper
  var last = { size: "140x210", paper: "u80", bleed: 3, flap: 0 };

  function diskFs() {
    try { var p = window.parent; return p && p !== window && p.orosFS ? p.orosFS : null; }
    catch (e) { return null; }
  }
  function safePath(p) {
    return typeof p === "string" && p.indexOf("/internal/") === 0 && !/(^|\/)\.\.(\/|$)/.test(p) && IMG_EXT.test(p) ? p : "";
  }
  function numOf(v) {
    var n = typeof v === "number" ? v : parseFloat(String(v || "").replace(",", "."));
    return isFinite(n) ? n : NaN;
  }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : ""; }

  function open(pre) {
    pre = pre && typeof pre === "object" ? pre : {};
    var U = LY.ui;
    var f = {
      title: str(pre.title, 200), sub: str(pre.sub, 200), author: str(pre.author, 200),
      blurb: str(pre.blurb, 4000), imprint: str(pre.imprint, 120), isbn: str(pre.isbn, 20),
      isbnShown: str(pre.isbnShown, 20), price: str(pre.price, 40),
      pages: numOf(pre.pages) > 0 ? Math.round(numOf(pre.pages)) : 160,
      size: last.size, w: 140, h: 210, paper: last.paper, spine: numOf(pre.spine) > 0 && numOf(pre.spine) <= 150 ? numOf(pre.spine) : "", flap: last.flap, bleed: last.bleed
    };
    var pw = numOf(pre.w), ph = numOf(pre.h);
    if (pw >= 50 && pw <= 500 && ph >= 50 && ph <= 700) {
      var hit = CV.SIZES.filter(function (s) { return s[1] === pw && s[2] === ph; })[0];
      f.size = hit ? hit[0] : "custom"; f.w = pw; f.h = ph;
    } else {
      var cur = CV.SIZES.filter(function (s) { return s[0] === f.size; })[0];
      if (cur) { f.w = cur[1]; f.h = cur[2]; }
    }
    // the front picture and the publisher's logo: { disk: path, dev: File }
    var pics = { img: { disk: safePath(pre.img), dev: null }, logo: { disk: safePath(pre.logo), dev: null } };

    LY.openDialog(t("cov.title"), function (body, close) {
      body.appendChild(el("p", "hint", t("cov.intro")));
      function txt(key, prop, max, area) {
        var i = el(area ? "textarea" : "input", "inp");
        if (!area) i.type = "text";
        else i.rows = 4;
        i.maxLength = max; i.value = f[prop];
        i.addEventListener("input", function () { f[prop] = i.value; });
        return U.field(t(key), i);
      }
      function numBox(key, prop, onIn) {
        var i = el("input", "inp num");
        i.type = "text"; i.inputMode = "decimal"; i.autocomplete = "off";
        i.value = f[prop] === "" ? "" : String(f[prop]);
        i.addEventListener("input", function () { f[prop] = i.value.trim() === "" ? "" : numOf(i.value); if (onIn) onIn(); });
        return { box: U.field(t(key), i), inp: i };
      }
      body.appendChild(txt("cov.f.title", "title", 200));
      body.appendChild(txt("cov.f.sub", "sub", 200));
      body.appendChild(txt("cov.f.author", "author", 200));

      // size + paper → spine
      var g1 = el("div", "grid2");
      var sizes = CV.SIZES.map(function (s) { return [s[0], s[1] + " × " + s[2] + " mm"]; }).concat([["custom", t("new.custom")]]);
      var wBox = numBox("cov.f.w", "w", spineHint), hBox = numBox("cov.f.h", "h");
      var custom = el("div", "grid2");
      custom.appendChild(wBox.box); custom.appendChild(hBox.box);
      custom.hidden = f.size !== "custom";
      g1.appendChild(U.field(t("cov.f.size"), U.select(sizes, f.size, function (v) {
        f.size = v;
        var s = CV.SIZES.filter(function (x) { return x[0] === v; })[0];
        if (s) { f.w = s[1]; f.h = s[2]; wBox.inp.value = String(s[1]); hBox.inp.value = String(s[2]); }
        custom.hidden = v !== "custom";
      })));
      var pgBox = numBox("cov.f.pages", "pages", spineHint);
      g1.appendChild(pgBox.box);
      body.appendChild(g1);
      body.appendChild(custom);
      var g2 = el("div", "grid2");
      g2.appendChild(U.field(t("cov.f.paper"), U.select(CV.PAPERS.map(function (p) { return [p[0], t("cov.p." + p[0])]; }), f.paper, function (v) {
        f.paper = v; spineHint();
      })));
      var spBox = numBox("cov.f.spine", "spine", spineHint);
      g2.appendChild(spBox.box);
      body.appendChild(g2);
      var hint = el("p", "hint");
      body.appendChild(hint);
      function calc() { return CV.spineMm(f.pages, CV.paper(f.paper)); }
      function spineHint() {
        spBox.inp.placeholder = String(calc());
        hint.textContent = t("cov.spineHint", { mm: f.spine === "" || !isFinite(f.spine) ? calc() : f.spine });
      }
      spineHint();
      var g3 = el("div", "grid2");
      g3.appendChild(numBox("cov.f.flap", "flap").box);
      g3.appendChild(numBox("cov.f.bleed", "bleed").box);
      body.appendChild(g3);

      body.appendChild(txt("cov.f.blurb", "blurb", 4000, true));
      var g4 = el("div", "grid2");
      g4.appendChild(txt("cov.f.isbn", "isbn", 20));
      g4.appendChild(txt("cov.f.price", "price", 40));
      body.appendChild(g4);
      body.appendChild(txt("cov.f.imprint", "imprint", 120));

      // the front picture and the logo
      ["img", "logo"].forEach(function (k) {
        var P = pics[k], row = el("div", "dlg-actions"), nm = el("span", "hint");
        function show() { nm.textContent = P.dev ? P.dev.name : P.disk ? P.disk.split("/").pop() : t(k === "img" ? "cov.noPic" : "cov.noLogo"); }
        var fileIn = el("input"); fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.hidden = true;
        fileIn.addEventListener("change", function () {
          var fl = fileIn.files && fileIn.files[0];
          if (fl && fl.size <= IMG_MAX) { P.dev = fl; P.disk = ""; }
          show();
        });
        row.appendChild(el("span", "fld-lbl", t(k === "img" ? "cov.f.pic" : "cov.f.logo")));
        row.appendChild(nm);
        row.appendChild(el("span", "spacer"));
        row.appendChild(U.btn(t("cov.pickPic"), function () { fileIn.click(); }));
        body.appendChild(row);
        body.appendChild(fileIn);
        show();
      });

      var bad = el("p", "hint warn");
      bad.hidden = true;
      body.appendChild(bad);
      var act = el("div", "dlg-actions");
      act.appendChild(el("span", "spacer"));
      act.appendChild(U.btn(t("btn.cancel"), close));
      var go = U.btn(t("btn.create"), function () {
        var w = numOf(f.w), h = numOf(f.h);
        if (!(w >= 50 && w <= 500 && h >= 50 && h <= 700)) { bad.textContent = t("cov.badSize"); bad.hidden = false; return; }
        if (f.isbn.trim() && !CV.isbn13(f.isbn)) { bad.textContent = t("cov.badIsbn"); bad.hidden = false; return; }
        go.disabled = true;
        last.size = f.size; last.paper = f.paper;
        last.flap = isFinite(numOf(f.flap)) ? numOf(f.flap) : 0;
        last.bleed = isFinite(numOf(f.bleed)) ? numOf(f.bleed) : 3;
        var spec = {
          name: f.title.trim() ? t("cov.docName", { title: f.title.trim() }) : t("cov.title"),
          w: w, h: h, pages: f.pages, sheet: CV.paper(f.paper),
          flap: last.flap, bleed: last.bleed, title: f.title, sub: f.sub, author: f.author, blurb: f.blurb,
          imprint: f.imprint, isbn: f.isbn, isbnShown: f.isbnShown, price: f.price
        };
        if (f.spine !== "" && isFinite(f.spine)) spec.spine = f.spine;
        Promise.all([picture(pics.img), picture(pics.logo)]).then(function (res) {
          if (res[0]) spec.img = { a: res[0].id, iw: res[0].w, ih: res[0].h, nm: res[0].name };
          if (res[1]) spec.logo = { a: res[1].id, iw: res[1].w, ih: res[1].h, nm: res[1].name };
          close();
          LY.addDoc(CV.build(spec, { now: LY.now(), lang: LY.BASE }));
          if (res[0] === false || res[1] === false) LY.toast(t("img.fail"));
        });
      }, "primary");
      act.appendChild(go);
      body.appendChild(act);
    }, true);

    // → the asset { id, w, h, name }, null (no picture) or false (failed)
    function picture(P) {
      var src;
      if (P.dev) src = Promise.resolve(P.dev);
      else if (P.disk && diskFs()) {
        src = Promise.resolve(diskFs().read(P.disk)).then(function (blob) {
          return blob && blob.size && blob.size <= IMG_MAX ? new File([blob], P.disk.split("/").pop(), { type: blob.type || "" }) : null;
        });
      } else return Promise.resolve(null);
      return src.then(function (file) { return file ? A.importFile(file) : false; }).then(null, function () { return false; });
    }
  }

  LY.cover = { open: open };
})();
