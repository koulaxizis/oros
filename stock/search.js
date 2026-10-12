// ============================================================
// orOS Stock — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-stock-data, never writes.
// Hits:
//   • a product: its name; SKU, barcode, category, location,
//     supplier and note as text (archived products are skipped)
//   • a supplier: its name; contact person, phone, e-mail, VAT no.
// Deleted rows leave the lists (tombstones in tombs{}); a row whose
// tombstone is at or after its m is skipped too, the way the merge
// hides it (a product with movements always stays, as in the merge).
// Opens through the generic deep link: __orosOpenAt("stock",
// { item: id }) or { sup: id } (Stock's own receiver).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-stock-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }

  var PROVIDER = {
    id: "stock",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.items)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      var used = {};
      arr(d.moves).forEach(function (mv) {
        arr(mv && mv.lines).forEach(function (l) { if (l && typeof l.i === "string") used[l.i] = true; });
      });
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0) && !used[x.id]);
      }
      var cats = {}, sups = {};
      arr(d.cats).forEach(function (c) { if (!gone(c)) cats[c.id] = str(c.name); });
      arr(d.sups).forEach(function (s) {
        if (gone(s) || !str(s.name)) return;
        sups[s.id] = str(s.name);
        out.push({
          id: "s:" + s.id,
          title: str(s.name),
          text: [str(s.person), str(s.tel), str(s.email), str(s.vatno)].filter(Boolean).join(" · "),
          target: { sup: s.id }
        });
      });
      d.items.forEach(function (it) {
        if (gone(it) || it.arch === 1 || !str(it.name)) return;
        out.push({
          id: "i:" + it.id,
          title: str(it.name),
          text: [str(it.sku), str(it.bc), cats[it.cat] || "", str(it.loc), sups[it.sup] || "",
                 str(it.ssku), str(it.note).split("\n")[0]].filter(Boolean).join(" · "),
          target: { item: it.id }
        });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
