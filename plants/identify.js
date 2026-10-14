// ============================================================
// orOS Plant Care — identify.js (photo identification, v1.0.0)
// The pure half of "Identify from a photo": the request to the
// Pl@ntNet identification API (v2) with the person's OWN free API
// key (never a shared key: orOS ships none), and the reading of
// its answer. The app (plants.js) does the network call, only when
// the person picks a photo and presses Identify.
// No DOM, no network, no storage here.
//
// API (window.OrosPlantsIdentify, module.exports under Node):
//   ENDPOINT, ATTRIBUTION, SITE
//   keyOk(key) → bool (the shape of a Pl@ntNet key)
//   url(key, lang) → the request URL (lang "el" / "en"; key encoded)
//   results(json, max) → [{ sci, author, common: [..], family, genus, score }]
//     (score 0–1, best first, at most max (default 5), junk dropped)
//   remaining(json) → number | null (identifications left today)
//   errorKind(status) → "key" | "none" | "quota" | "photo" | "server"
//   presetFor(sci, presets) → a Plant Care species id | ""
// ============================================================
(function (root) {
  "use strict";

  var ENDPOINT = "https://my-api.plantnet.org/v2/identify/all";
  var SITE = "https://my.plantnet.org/";
  // Off since 2026-10-14: Pl@ntNet reportedly treats one sign-up per app
  // user as against its terms, so the button and the key field stay
  // hidden until Pl@ntNet agrees (Chris's decision). The code stays.
  var ENABLED = false;
  // Pl@ntNet terms of use: free use acknowledges the service.
  var ATTRIBUTION = "The image-based plant species identification service used, is based on the Pl@ntNet recognition API, regularly updated and accessible through the site https://my.plantnet.org/";
  var KEY_RE = /^[A-Za-z0-9_-]{10,80}$/;
  var TEXT_MAX = 80;

  function keyOk(key) { return typeof key === "string" && KEY_RE.test(key.trim()); }

  function url(key, lang) {
    var l = lang === "el" ? "el" : "en";
    return ENDPOINT + "?api-key=" + encodeURIComponent(String(key || "").trim()) +
      "&lang=" + l + "&nb-results=5&include-related-images=false&no-reject=false";
  }

  function clean(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
  }
  function nameOf(o) {
    if (!o || typeof o !== "object") return "";
    return clean(o.scientificNameWithoutAuthor) || clean(o.scientificName);
  }

  function results(json, max) {
    var lim = max > 0 ? max : 5;
    var list = json && Array.isArray(json.results) ? json.results : [];
    var out = [], seen = {};
    list.forEach(function (r) {
      if (!r || typeof r !== "object" || !r.species) return;
      var score = typeof r.score === "number" && isFinite(r.score) ? Math.max(0, Math.min(1, r.score)) : 0;
      var sp = r.species, sci = nameOf(sp);
      if (!sci || seen[sci]) return;
      seen[sci] = true;
      var common = [];
      (Array.isArray(sp.commonNames) ? sp.commonNames : []).forEach(function (c) {
        var n = clean(c);
        if (n && common.indexOf(n) < 0 && common.length < 3) common.push(n);
      });
      out.push({
        sci: sci,
        author: clean(sp.scientificNameAuthorship),
        common: common,
        family: nameOf(sp.family),
        genus: nameOf(sp.genus) || sci.split(" ")[0],
        score: score
      });
    });
    out.sort(function (a, b) { return b.score - a.score || (a.sci < b.sci ? -1 : 1); });
    return out.slice(0, lim);
  }

  function remaining(json) {
    var n = json && json.remainingIdentificationRequests;
    return typeof n === "number" && isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }

  function errorKind(status) {
    if (status === 401 || status === 403) return "key";
    if (status === 404) return "none";              // "Species not found"
    if (status === 429) return "quota";
    if (status === 400 || status === 413 || status === 415) return "photo";
    return "server";
  }

  // Genus (or full name) → the ready species of Plant Care, so a
  // pick can also fill the care values. Suggestions only.
  var GENUS = {
    Epipremnum: "pothos", Scindapsus: "pothos", Monstera: "monstera", Dracaena: "dracaena",
    Sansevieria: "snake", Zamioculcas: "zz", Chlorophytum: "spider", Spathiphyllum: "peace",
    Phalaenopsis: "orchid", Dendrobium: "orchid", Cattleya: "orchid", Oncidium: "orchid",
    Nephrolepis: "fern", Adiantum: "fern", Asplenium: "fern", Pteris: "fern",
    Calathea: "calathea", Goeppertia: "calathea", Maranta: "calathea", Ctenanthe: "calathea",
    Aloe: "aloe", Opuntia: "cactus", Mammillaria: "cactus", Echinocactus: "cactus", Cereus: "cactus",
    Echeveria: "succulent", Crassula: "succulent", Sedum: "succulent", Haworthia: "succulent",
    Kalanchoe: "succulent", Sempervivum: "succulent", Graptopetalum: "succulent",
    Begonia: "begonia", Saintpaulia: "violet", Streptocarpus: "violet", Ocimum: "basil", Mentha: "mint",
    Salvia: "", Rosmarinus: "rosemary", Lavandula: "lavender", Pelargonium: "geranium", Geranium: "geranium",
    Solanum: "", Bougainvillea: "bougainvillea", Citrus: "citrus", Olea: "olive"
  };
  var SPECIES = {
    "Ficus elastica": "rubber", "Salvia rosmarinus": "rosemary", "Solanum lycopersicum": "tomato",
    "Olea europaea": "olive", "Aloe vera": "aloe"
  };
  function presetFor(sci, presets) {
    var s = clean(sci);
    if (!s) return "";
    var parts = s.split(" "), two = parts.slice(0, 2).join(" ");
    var id = SPECIES[two] || "";
    if (!id && parts[0] === "Ficus") id = "ficus";
    if (!id && Object.prototype.hasOwnProperty.call(GENUS, parts[0])) id = GENUS[parts[0]];
    return id && presets && Object.prototype.hasOwnProperty.call(presets, id) ? id : "";
  }

  var API = {
    ENDPOINT: ENDPOINT, SITE: SITE, ATTRIBUTION: ATTRIBUTION, ENABLED: ENABLED,
    keyOk: keyOk, url: url, results: results, remaining: remaining, errorKind: errorKind, presetFor: presetFor
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPlantsIdentify = API;
})(typeof window !== "undefined" ? window : null);
