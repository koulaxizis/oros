// ============================================================
// orOS Mockups — goods/combo.js (v1.0.0)
// Several mockups in one picture (Mockups v2 wave 9): a "combo" holds
// the ids of up to 6 of the person's own mockups (books or products)
// and lays them out together, on a table or flat from above. Kits make
// a ready set of products with one picture and the combo of them.
// Pure part (Node-tested); scene.js builds it (buildCombo).
// ============================================================
(function (root) {
  "use strict";
  var C = root.MockCore || (typeof require === "function" ? require("../core.js") : null);
  var MM = root.MockMedia || (typeof require === "function" ? require("./media.js") : null);
  if (!C || !MM) return;
  var pick = MM.pick;
  var MAX = 6, LAYS = ["table", "flat"], ID = /^k[0-9a-z]{6,24}$/;   // MockCore project ids
  // what each kit makes, in the order they stand in the picture
  var KITS = {
    band: ["vinyl", "cd", "tshirt", "tote", "badge"],
    book: ["book", "tote", "mug", "card", "badge"],
    brand: ["mug", "cap", "tote", "sticker", "poster"],
    wear: ["tshirt", "hoodie", "cap", "socks"]
  };
  function norm(g) {
    g = g && typeof g === "object" ? g : {};
    var items = [];
    (Array.isArray(g.items) ? g.items : []).forEach(function (id) {
      if (typeof id === "string" && ID.test(id) && items.indexOf(id) < 0 && items.length < MAX) items.push(id);
    });
    return { items: items, lay: pick(g.lay, LAYS, "table") };
  }
  function dims() { return { w: 0, h: 0, d: 0 }; }
  // the picture slot a kit fills on each kind (its main print)
  function mainSlot(kind) {
    if (kind === "book") return "front";
    var d = C.good(kind);
    if (!d) return null;
    var s = typeof d.shown === "function" ? d.shown(d.norm({})) : ["front"];
    return s[0] || "front";
  }
  // Can this project go in a combo? (not a combo; known here)
  function canHold(p) { return !!p && p.kind !== "combo" && C.known(p); }
  // Add / remove an id (returns new g).
  function add(g, id) { g = norm(g); if (g.items.indexOf(id) < 0) g.items.push(id); return norm(g); }
  function del(g, id) { g = norm(g); g.items = g.items.filter(function (x) { return x !== id; }); return g; }

  var A = { VERSION: "1.0.0", MAX: MAX, LAYS: LAYS, KITS: KITS, norm: norm, mainSlot: mainSlot, canHold: canHold, add: add, del: del };
  C.addGood("combo", { group: "scene", slots: [], norm: norm, dims: dims, sheets: function () { return []; }, template: function () { return null; },
    wrap: false, noOpen: true, combo: true, place: "stand", cam: { th: -22, ph: 16 }, out: { ratio: "3:2" },
    opts: [{ k: "lay", t: "seg", v: LAYS, p: "lay.", l: "f.lay" }], shown: function () { return []; } });
  root.MockCombo = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
