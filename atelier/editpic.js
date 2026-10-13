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
// parse() is pure and unit-tested; the rest needs the app.
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

  if (typeof module !== "undefined" && module.exports) { module.exports = { parse: parse, keyOf: keyOf }; return; }

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

  AT.editPic = { can: can, open: open, back: back, parse: parse };
})(typeof window !== "undefined" ? window : this);
