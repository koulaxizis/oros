// ============================================================
// orOS Atelier — editpic.js: "Edit in Photo Lab" (v1.0.0)
// Bridge BR-PL-EDIT (/mnt/project-files/image-editor/
// atelier-edit-picture-contract.md):
//   Atelier → Photo Lab: __orosOpenAt("photolab", { openFile:
//     "/internal/Assets/<file>", back: { app: "atelier",
//     key: "<doc id>:<element id>" } })
//   Photo Lab → Atelier (its "Done"): __orosOpenAt("atelier",
//     { editedPicture: { key, path: "/internal/Assets/<sha256>.png", w, h } })
//     → core.js openSearchTarget → back(): the design opens, the photo
//     keeps its box and shows the new picture (one undoable step).
// Unknown keys (design or element deleted meanwhile) only say so.
// Also the bridges with Mockups:
//   Atelier → Mockups (More › Make a book mockup, BR-AT-MK): the
//     first pages drawn to pictures on the orOS disk, then
//     __orosOpenAt("mockups", { cover: { front, back, spine | wrap,
//     name, w, h (mm) } }); plan() decides which page is which.
//   Mockups → Atelier ("Open in Atelier", BR-MK-AT):
//     __orosOpenAt("atelier", { newPicture: { path, w, h, name } })
//     → a new design of the picture's size holding it.
//   Mockups → Atelier (Print tab › "Design it in Atelier", BR-MK-TPL):
//     __orosOpenAt("atelier", { newTemplate: { guides, art, w, h,
//     bleed (mm, trim size of the whole cover sheet), name } }) → a
//     new mm design of the sheet's trim with that bleed, the cover
//     picture (art, optional) and the guides as a locked picture on
//     top marked ax.tg: seen in the editor, clicked through, never
//     drawn in exports (draw.js clean, pdfout.js, pptxout.js). Its
//     "Make a book mockup" sends the wrap with its trim size (ww,
//     wh), so Mockups finds the book it was made for.
// parse(), plan(), parseNew() and parseTpl() are pure and
// unit-tested; the rest needs the app.
// ============================================================
(function (root) {
  "use strict";

  var ID = "[a-z]{1,4}-[a-z0-9]{1,24}";                  // designkit model ids
  var KEY = new RegExp("^(" + ID + "):(" + ID + ")$");
  var PATH = /^\/internal\/Assets\/([0-9a-f]{64}\.(png|jpg))$/;

  // editedPicture → { doc, item, asset, w, h } | null
  function parse(ep) {
    if (!ep || typeof ep !== "object") return null;
    var k = typeof ep.key === "string" ? KEY.exec(ep.key) : null;
    var p = typeof ep.path === "string" ? PATH.exec(ep.path) : null;
    if (!k || !p) return null;
    function dim(v) { return typeof v === "number" && isFinite(v) && v >= 1 && v <= 100000 ? Math.round(v) : 0; }
    return { doc: k[1], item: k[2], asset: p[1], w: dim(ep.w), h: dim(ep.h) };
  }
  function keyOf(docId, itemId) { return docId + ":" + itemId; }

  // Which page becomes what on the book: one wide page (a full wrap:
  // back + spine + front) or front / back / spine in page order.
  // n: page count, w/h: page size (any unit) → { wrap } | { front, back, spine } (page indexes)
  function plan(n, w, h) {
    if (!(n >= 1) || !(w > 0) || !(h > 0)) return null;
    if (n === 1 && w / h >= 1.25) return { wrap: 0 };
    var o = { front: 0 };
    if (n >= 2) o.back = 1;
    if (n >= 3) o.spine = 2;
    return o;
  }
  // newPicture → { asset, w, h, name } | null
  function parseNew(np) {
    if (!np || typeof np !== "object") return null;
    var p = typeof np.path === "string" ? PATH.exec(np.path) : null;
    if (!p) return null;
    function dim(v) { return typeof v === "number" && isFinite(v) && v >= 1 && v <= 100000 ? Math.round(v) : 0; }
    var name = typeof np.name === "string" ? np.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) : "";
    return { asset: p[1], w: dim(np.w), h: dim(np.h), name: name };
  }

  // newTemplate → { guides, art (asset or ""), w, h, bleed (mm), name } | null
  function parseTpl(nt) {
    if (!nt || typeof nt !== "object") return null;
    var g = typeof nt.guides === "string" ? PATH.exec(nt.guides) : null;
    var a = typeof nt.art === "string" && nt.art ? PATH.exec(nt.art) : null;
    if (!g || (nt.art && !a)) return null;
    function mm(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v * 1000) / 1000 : -1; }
    var w = mm(nt.w, 20, 2000), h = mm(nt.h, 20, 2000), b = mm(nt.bleed, 0, 25);
    if (w < 0 || h < 0 || b < 0) return null;
    var name = typeof nt.name === "string" ? nt.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) : "";
    return { guides: g[1], art: a ? a[1] : "", w: w, h: h, bleed: b, name: name };
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { parse: parse, keyOf: keyOf, plan: plan, parseNew: parseNew, parseTpl: parseTpl }; return; }

  var AT = root.AT, t = AT.t, M = AT.M, A = AT.A, ED = AT.ed;

  function shell() {
    try { var p = root.parent; return p && p !== root && typeof p.__orosOpenAt === "function" ? p : null; }
    catch (e) { return null; }
  }
  function can(it) {
    return !!(it && it.ax && it.ax.k === "photo" && !it.ax.vid && it.a && shell());
  }
  function open(itemId) {
    var it = AT.doc && M.find(AT.doc.items, itemId), p = shell();
    if (!can(it) || !p) return;
    AT.flush();
    p.__orosOpenAt("photolab", {
      openFile: "/internal/Assets/" + it.a,
      back: { app: "atelier", key: keyOf(AT.doc.id, it.id) }
    });
  }

  function back(ep) {
    var r = parse(ep);
    if (!r) return;
    var d = AT.findDoc(r.doc), it = d && M.find(d.items, r.item);
    if (!it || !it.ax || it.ax.k !== "photo") { AT.toast(t("ep.gone")); return; }
    A.load(r.asset).then(function (img) {
      if (!img) { AT.toast(t("ep.missing")); return; }
      var w = img.naturalWidth || img.width || r.w, h = img.naturalHeight || img.height || r.h;
      if (!AT.doc || AT.doc.id !== r.doc) {
        if (document.querySelector("dialog[open]")) return;
        if (AT.doc) AT.goHome();
        AT.openDoc(r.doc);
      }
      if (!AT.doc || AT.doc.id !== r.doc) return;
      AT.noteUpload(r.asset);
      var ok = AT.editItems([r.item], function (x) {
        if (x.a === r.asset) return false;
        var sameShape = x.iw > 0 && x.ih > 0 && Math.abs(x.iw / x.ih - w / h) < 0.005;
        if (x.fit === "custom" && !sameShape) { x.fit = "fill"; x.ix = 0; x.iy = 0; x.isc = 1; }
        else if (x.fit === "custom" && x.iw > 0) {
          // same shape, other size: the same crop (drawn size iw × isc)
          x.isc = x.isc * x.iw / w;
        }
        x.a = r.asset; x.iw = w; x.ih = h;
      });
      if (ED.select) ED.select([r.item]);
      if (ok) AT.toast(t("ep.done"), t("btn.undo"), AT.undo);
    }, function () { AT.toast(t("ep.missing")); });
  }

  // ---------- Mockups ----------
  function mockupsInstalled() {
    var p = shell();
    try {
      if (!p || typeof p.orosAssistInstalled !== "function") return !!p;
      return p.orosAssistInstalled().some(function (a) { return a && a.id === "mockups"; });
    } catch (e) { return !!p; }
  }
  function toMockup() {
    var d = AT.doc, p = shell();
    if (!d || !p) return;
    var pages = M.pagesInOrder(d), s = d.setup, pl = plan(pages.length, s.w, s.h);
    if (!pl) return;
    AT.flush();
    AT.toast(t("mk.making"));
    var scale = Math.min(4, 2400 / Math.max(s.w, s.h));
    var slots = Object.keys(pl);
    AT.prepareDoc(d, scale).then(function () {
      return Promise.all(slots.map(function (k) {
        var cv = AT.draw.renderPage(d, pages[pl[k]], scale, { maxSide: 0, background: "#ffffff" });
        return new Promise(function (res) { cv.toBlob(res, "image/png"); }).then(function (b) {
          if (!b) throw new Error("encode");
          var f;
          try { f = new File([b], k + ".png", { type: "image/png" }); } catch (e) { f = b; }
          return A.importFile(f).then(function (r) { return [k, r.id]; });
        });
      }));
    }).then(function (pairs) {
      var cover = { name: String(d.name || "").slice(0, 80) };
      pairs.forEach(function (x) { cover[x[0]] = x[1]; });
      var unit = s.unit === "mm" || s.unit === "in" ? s.unit : "";
      var wrap = pl.wrap !== undefined;      // page index 0
      if (unit && !wrap) { cover.w = s.w / M.PT_PER.mm; cover.h = s.h / M.PT_PER.mm; }
      if (unit && wrap) { cover.ww = s.w / M.PT_PER.mm; cover.wh = s.h / M.PT_PER.mm; }
      p.__orosOpenAt("mockups", { cover: cover });
    }).catch(function () { AT.toast(t("mk.fail")); });
  }
  function fromPicture(np) {
    var r = parseNew(np);
    if (!r) return;
    A.load(r.asset).then(function (img) {
      if (!img) { AT.toast(t("ep.missing")); return; }
      if (document.querySelector("dialog[open]")) return;
      var w = img.naturalWidth || img.width || r.w, h = img.naturalHeight || img.height || r.h;
      var nw = AT.now();
      var d = AX.newDesign({ name: r.name || "Mockup", w: w, h: h, unit: "px" }, nw);
      var pg = M.pagesInOrder(d)[0];
      AX.addItem(d, pg.id, { k: "photo", a: r.asset, iw: w, ih: h, nm: r.name, x: 0, y: 0, w: w, h: h, fit: "fill" }, nw);
      AT.noteUpload(r.asset);
      if (AT.doc) AT.goHome();
      AT.addDoc(M.normDoc(d));
      AT.toast(t("np.done"));
    }, function () { AT.toast(t("ep.missing")); });
  }

  function fromTemplate(nt) {
    var r = parseTpl(nt);
    if (!r) return;
    Promise.all([A.load(r.guides), r.art ? A.load(r.art) : Promise.resolve(null)]).then(function (im) {
      if (!im[0] || (r.art && !im[1])) { AT.toast(t("ep.missing")); return; }
      if (document.querySelector("dialog[open]")) return;
      var PT = M.PT_PER.mm, nw = AT.now();
      var d = AX.newDesign({ name: r.name || "Cover", w: r.w * PT, h: r.h * PT, unit: "mm" }, nw);
      d.setup.bleed = r.bleed * PT;
      var pg = M.pagesInOrder(d)[0], b = r.bleed * PT, box = { x: -b, y: -b, w: (r.w + 2 * r.bleed) * PT, h: (r.h + 2 * r.bleed) * PT };
      function size(img) { return { iw: img.naturalWidth || img.width, ih: img.naturalHeight || img.height }; }
      if (r.art) {
        var sa = size(im[1]);
        AX.addItem(d, pg.id, Object.assign({ k: "photo", a: r.art, iw: sa.iw, ih: sa.ih, nm: r.name, fit: "fill" }, box), nw);
        AT.noteUpload(r.art);
      }
      var sg = size(im[0]);
      AX.addItem(d, pg.id, Object.assign({ k: "photo", a: r.guides, iw: sg.iw, ih: sg.ih, nm: t("nt.guides"), fit: "fill", lock: 1, tg: 1, z: 1e8 }, box), nw);
      AT.noteUpload(r.guides);
      if (AT.doc) AT.goHome();
      AT.addDoc(M.normDoc(d));
      AT.toast(t("nt.done"));
    }, function () { AT.toast(t("ep.missing")); });
  }

  var AX = AT.AX;
  AT.editPic = { can: can, open: open, back: back, parse: parse };
  AT.mockup = { can: mockupsInstalled, open: toMockup, fromPicture: fromPicture, fromTemplate: fromTemplate };
})(typeof window !== "undefined" ? window : this);
