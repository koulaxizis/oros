// ============================================================
// orOS Scanner & PDF — universal search provider
// Declared in apps.json as "search": "search.js"; the shell loads it
// on the first menu search, never at boot. READ-ONLY: it reads the
// device-local list of PDFs the app saved into Files
// (oros-scanpdf-index: name, the text read from their pages, when)
// and never writes. A PDF since deleted or moved in Files is left
// out (orOS disk stat). Opening goes through the generic deep link
// __orosOpenAt: target { paths: [path] } adds that PDF's pages.
// Signature requests: the list of requests (oros-scanpdf-sign, sync
// slice scanpdfSign) by document and signer, target { signList: 1 };
// and one "Ask someone to sign a PDF" hit found by e-signature words
// in English and Greek (and a pack language's), target { signNew: 1 }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-scanpdf-index";
  var SIGN_KEY = "oros-scanpdf-sign";
  var MAX = 100;
  // English and Greek here; a pack language (orosI18n) adds its own
  // lines, and its search words join the English and Greek ones.
  var ASK = {
    en: { "sx.ask": "Ask someone to sign a PDF", "sx.req": "Signature request",
          "sx.words": "sign PDF e-signature esignature electronic signature request a signature signature request DocuSign" },
    el: { "sx.ask": "Ζήτα από κάποιον να υπογράψει ένα PDF", "sx.req": "Αίτηση υπογραφής",
          "sx.words": "υπογραφή PDF ηλεκτρονική υπογραφή αίτημα υπογραφής αίτηση υπογραφής ψηφιακή υπογραφή υπογραφή εγγράφου" }
  };
  var WORDS = ASK.en["sx.words"] + " " + ASK.el["sx.words"];

  function signHits(raw, lang) {
    var out = [], items = raw && raw.items && typeof raw.items === "object" ? raw.items : {};
    Object.keys(items).forEach(function (id) {
      var it = items[id], q = it && it.q;
      if (!it || it.gone || !q || typeof q.n !== "string") return;
      out.push({ id: "sign:" + id, title: q.n, when: Number(it.a) || undefined, target: { signList: 1 },
                 text: ASK[lang]["sx.req"] + " · " + (typeof q.to === "string" ? q.to : "") + " " + (typeof q.te === "string" ? q.te : "") });
    });
    return out.slice(0, MAX);
  }

  function clean(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (e) {
      if (!e || typeof e.p !== "string" || e.p.indexOf("/internal/") !== 0 || seen[e.p]) return;
      seen[e.p] = true;
      out.push({ p: e.p, n: typeof e.n === "string" ? e.n : "", t: typeof e.t === "string" ? e.t : "",
                 d: Number(e.d) || 0 });
    });
    return out.slice(0, MAX);
  }

  var PROVIDER = {
    id: "scanpdf",
    keys: [KEY, SIGN_KEY],
    // ctx = { q, words, fold, lang, limit, readJSON(key) }
    search: function (ctx) {
      // orosI18n (the shell's ../i18n.js): a pack language included.
      var I = typeof window !== "undefined" && window.orosI18n, lang = ctx.lang || "en";
      if (I && !ASK[lang]) I.table(ASK, "scanpdf", lang);
      if (!ASK[lang]) lang = "en";
      var words = lang === "en" || lang === "el" ? WORDS : WORDS + " " + (ASK[lang]["sx.words"] || "");
      var extra = [{ id: "sign:new", title: ASK[lang]["sx.ask"], text: words, target: { signNew: 1 } }]
        .concat(signHits(ctx.readJSON(SIGN_KEY), lang));
      var list = clean(ctx.readJSON(KEY));
      var fs = null;
      try { fs = root && root.orosFS; } catch (e) { fs = null; }
      function hit(e) {
        var name = e.n.trim() || e.p.slice(e.p.lastIndexOf("/") + 1).replace(/\.pdf$/i, "");
        return { id: e.p, title: name, text: e.t, when: e.d || undefined, target: { paths: [e.p] } };
      }
      if (!fs || typeof fs.stat !== "function") return list.map(hit).concat(extra);
      return Promise.all(list.map(function (e) {
        return Promise.resolve(fs.stat(e.p)).then(function (st) { return st ? hit(e) : null; }, function () { return null; });
      })).then(function (hits) { return hits.filter(Boolean).concat(extra); });
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
