// ============================================================
// orOS Mockups — universal search provider (v1.4.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-mockups-data and (v1.1.0) the
// products in oros-mockups-goods, never writes. One hit per mockup:
// its name as title, and as text the book's size, pages, binding and
// spine text, or the product (CD, DVD / Blu-ray, and since v1.2.0 cassette, VHS, vinyl; v1.3.0 badge, sticker, keychain, pin, magnet, mug, poster, card; v1.4.0 T-shirt, tote bag).
// Opens through __orosOpenAt("mockups", { id }).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mockups-data", GKEY = "oros-mockups-goods";
  // Runs in the shell, which loads only its own pack: a pack language shows English.
  var S = {
    en: { "search.name": "Book mockup", "bind.pb": "Paperback", "bind.hc": "Hardcover", "bind.ss": "Saddle-stitched", "bind.sp": "Spiral", "bind.bb": "Board book", "bind.lf": "Lay-flat", "search.pages": "pages", "search.cd": "CD", "search.dvd": "DVD", "search.bd": "Blu-ray", "search.tape": "Cassette", "search.vhs": "VHS", "search.vinyl": "Vinyl", "search.badge": "Badge", "search.sticker": "Sticker", "search.keychain": "Keychain", "search.pin": "Enamel pin", "search.magnet": "Magnet", "search.mug": "Mug", "search.poster": "Framed poster", "search.card": "Card", "search.tshirt": "T-shirt", "search.tote": "Tote bag", "search.good": "Mockup" },
    el: { "search.name": "Μακέτα βιβλίου", "bind.pb": "Χαρτόδετο", "bind.hc": "Σκληρόδετο", "bind.ss": "Καρφίτσα", "bind.sp": "Σπιράλ", "bind.bb": "Χαρτονένιο", "bind.lf": "Ανοίγει επίπεδα", "search.pages": "σελίδες", "search.cd": "CD", "search.dvd": "DVD", "search.bd": "Blu-ray", "search.tape": "Κασέτα", "search.vhs": "VHS", "search.vinyl": "Βινύλιο", "search.badge": "Κονκάρδα", "search.sticker": "Αυτοκόλλητο", "search.keychain": "Μπρελόκ", "search.pin": "Καρφίτσα σμάλτου", "search.magnet": "Μαγνητάκι", "search.mug": "Κούπα", "search.poster": "Αφίσα σε κάδρο", "search.card": "Κάρτα", "search.tshirt": "T-shirt", "search.tote": "Πάνινη τσάντα", "search.good": "Μακέτα" }
  };
  var ID_RE = /^k[0-9a-z]{6,24}$/;

  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function n(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : 0; }

  // Products: only the kinds this version knows (CD, DVD / Blu-ray).
  function goods(d, lang, out) {
    if (!d || !Array.isArray(d.prj)) return;
    var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
    d.prj.forEach(function (p) {
      if (!p || typeof p.id !== "string" || !ID_RE.test(p.id)) return;
      if (tombs[p.id] && tombs[p.id] >= p.m) return;
      if (p.kind === "bd" || !S.en["search." + p.kind]) return;
      var g = p.g && typeof p.g === "object" ? p.g : {}, art = p.art && typeof p.art === "object" ? p.art : {};
      var k = p.kind === "dvd" && g.fmt === "bd" ? "bd" : p.kind, kn = S[lang]["search." + k];
      var parts = [kn];
      if (str(art.spT)) parts.push(str(art.spT));
      out.push({ id: p.id, title: str(p.nm) || S[lang]["search.good"] + " " + kn, text: parts.join(" · "), target: { id: p.id } });
    });
  }

  var PROVIDER = {
    id: "mockups",
    keys: [KEY, GKEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], lang = ctx.lang === "el" ? "el" : "en";
      goods(ctx.readJSON(GKEY), lang, out);
      if (!d || !Array.isArray(d.prj)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      d.prj.forEach(function (p) {
        if (!p || typeof p.id !== "string" || !ID_RE.test(p.id)) return;
        if (tombs[p.id] && tombs[p.id] >= p.m) return;
        var bk = p.bk && typeof p.bk === "object" ? p.bk : {}, art = p.art && typeof p.art === "object" ? p.art : {};
        var parts = [];
        if (n(bk.w) && n(bk.h)) parts.push(n(bk.w) + " × " + n(bk.h) + " mm");
        if (n(bk.pages)) parts.push(n(bk.pages) + " " + S[lang]["search.pages"]);
        if (S[lang]["bind." + bk.bind]) parts.push(S[lang]["bind." + bk.bind]);
        if (str(art.spT)) parts.push(str(art.spT));
        out.push({ id: p.id, title: str(p.nm) || S[lang]["search.name"], text: parts.join(" · "), target: { id: p.id } });
      });
      return out;
    },
    open: function (target, win) {
      if (win && typeof win.__orosOpenAt === "function") win.__orosOpenAt("mockups", target);
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
