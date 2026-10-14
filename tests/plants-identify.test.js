// Plant Care wave 34: identify from a photo with the person's own
// Pl@ntNet key (plants/identify.js, pure part) and the new optional
// plant field `sci` (plants/core.js), including sync with a copy that
// went through an older build.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ID = require(path.join(__dirname, "..", "plants/identify.js"));
const C = require(path.join(__dirname, "..", "plants/core.js"));

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);

const SAMPLE = {
  query: { project: "all", organs: ["auto"] },
  language: "en",
  preferedReferential: "k-world-flora",
  bestMatch: "Epipremnum aureum (Linden & André) G.S.Bunting",
  results: [
    { score: 0.12, species: { scientificNameWithoutAuthor: "Philodendron hederaceum", scientificNameAuthorship: "(Jacq.) Schott",
      genus: { scientificNameWithoutAuthor: "Philodendron" }, family: { scientificNameWithoutAuthor: "Araceae" }, commonNames: ["Heartleaf philodendron"] } },
    { score: 0.81234, species: { scientificNameWithoutAuthor: "Epipremnum aureum", scientificNameAuthorship: "(Linden & André) G.S.Bunting",
      genus: { scientificNameWithoutAuthor: "Epipremnum" }, family: { scientificNameWithoutAuthor: "Araceae" },
      commonNames: ["Golden pothos", "Devil's ivy", "Pothos", "Money plant", "<b>x</b>"] } },
    { score: 0.05, species: { scientificNameWithoutAuthor: "Epipremnum aureum" } },      // duplicate name
    { score: "high", species: { scientificNameWithoutAuthor: "Scindapsus pictus" } },     // bad score → 0
    { score: 0.3 },                                                                         // no species
    null
  ],
  remainingIdentificationRequests: 498
};

test("results: best first, de-duplicated, cleaned, at most n", () => {
  const r = ID.results(SAMPLE, 5);
  assert.equal(r.length, 3);
  assert.equal(r[0].sci, "Epipremnum aureum");
  assert.equal(r[0].family, "Araceae");
  assert.equal(r[0].genus, "Epipremnum");
  assert.ok(Math.abs(r[0].score - 0.81234) < 1e-9);
  assert.deepEqual(r[0].common, ["Golden pothos", "Devil's ivy", "Pothos"]);
  assert.equal(r[1].sci, "Philodendron hederaceum");
  assert.equal(r[2].sci, "Scindapsus pictus");
  assert.equal(r[2].score, 0);
  assert.equal(r[2].genus, "Scindapsus");
  assert.equal(ID.results(SAMPLE, 1).length, 1);
  assert.deepEqual(ID.results(null), []);
  assert.deepEqual(ID.results({ results: "x" }), []);
  const angle = ID.results({ results: [{ score: 1, species: { scientificNameWithoutAuthor: "<img src=x>Rosa" } }] });
  assert.ok(angle[0].sci.indexOf("<") < 0);
  assert.equal(ID.remaining(SAMPLE), 498);
  assert.equal(ID.remaining({}), null);
});

test("request URL: own key encoded, Greek or English, related images off", () => {
  const u = ID.url(" abc123DEF456ghi ", "el");
  assert.ok(u.indexOf(ID.ENDPOINT + "?api-key=abc123DEF456ghi&") === 0);
  assert.ok(/[?&]lang=el(&|$)/.test(u));
  assert.ok(/include-related-images=false/.test(u));
  assert.ok(/[?&]lang=en(&|$)/.test(ID.url("abc123DEF456ghi", "fr")));
  assert.ok(ID.url("a&b=c", "en").indexOf("a%26b%3Dc") > 0);
  assert.ok(ID.keyOk("2b10AbCdEfGhIjKlMnOpQrStU"));
  assert.ok(!ID.keyOk("short"));
  assert.ok(!ID.keyOk("has space inside key"));
  assert.ok(!ID.keyOk(null));
  assert.ok(/Pl@ntNet recognition API/.test(ID.ATTRIBUTION) && /https:\/\/my\.plantnet\.org\//.test(ID.ATTRIBUTION));
});

test("errors: key, not found, quota, photo, server", () => {
  assert.equal(ID.errorKind(401), "key");
  assert.equal(ID.errorKind(403), "key");
  assert.equal(ID.errorKind(404), "none");
  assert.equal(ID.errorKind(429), "quota");
  assert.equal(ID.errorKind(413), "photo");
  assert.equal(ID.errorKind(500), "server");
});

test("presetFor: genus or species to a ready species of Plant Care", () => {
  assert.equal(ID.presetFor("Epipremnum aureum", C.PRESETS), "pothos");
  assert.equal(ID.presetFor("Ficus elastica", C.PRESETS), "rubber");
  assert.equal(ID.presetFor("Ficus benjamina", C.PRESETS), "ficus");
  assert.equal(ID.presetFor("Salvia rosmarinus", C.PRESETS), "rosemary");
  assert.equal(ID.presetFor("Salvia officinalis", C.PRESETS), "");
  assert.equal(ID.presetFor("Quercus robur", C.PRESETS), "");
  assert.equal(ID.presetFor("", C.PRESETS), "");
  assert.equal(ID.presetFor("Epipremnum aureum", {}), "");
});

function plant(extra) {
  return Object.assign({ id: "plant01", m: 5, name: "Pothos", sp: "pothos", room: "Kitchen", out: 0, em: "🌿",
    w: 7, ww: 0, f: 0, mi: 0, r: 0, st: "2026-10-01", sn: {}, notes: "" }, extra || {});
}

test("sci: optional, cleaned, absent when empty (old plants keep their bytes)", () => {
  const old = C.normPlant(plant());
  assert.ok(!("sci" in old));
  assert.equal(JSON.stringify(C.merge({ plants: [plant()] }, null, NOW).plants[0]), JSON.stringify(old));
  const n = C.normPlant(plant({ sci: "  Epipremnum\u0000 aureum  " }));
  assert.equal(n.sci, "Epipremnum aureum");
  assert.ok(Object.keys(n).indexOf("sci") === Object.keys(n).indexOf("room") + 1);
  assert.ok(!("sci" in C.normPlant(plant({ sci: "   " }))));
  assert.ok(!("sci" in C.normPlant(plant({ sci: 42 }))));
  assert.equal(C.normPlant(plant({ sci: "x".repeat(200) })).sci.length, C.SCI_LEN);
});

test("sci syncs: newer edit wins; at equal m it beats a copy without it (older build)", () => {
  const withSci = plant({ sci: "Epipremnum aureum" });
  const without = plant();                 // what an older build hands back
  const a = C.merge({ plants: [withSci] }, { plants: [without] }, NOW);
  const b = C.merge({ plants: [without] }, { plants: [withSci] }, NOW);
  assert.equal(a.plants[0].sci, "Epipremnum aureum");
  assert.deepEqual(a, b);
  const cleared = plant({ m: 9 });         // a newer edit that removed it
  assert.ok(!("sci" in C.merge({ plants: [withSci] }, { plants: [cleared] }, NOW).plants[0]));
  const twice = C.merge(a, a, NOW);
  assert.deepEqual(twice, a);              // canonical, idempotent
});
