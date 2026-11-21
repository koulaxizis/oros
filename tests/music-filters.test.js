// Search filters of the Music app (MU-FIND1, music/open.js §9):
// one filter, mapped onto every open catalogue; a source that cannot
// honour a filter is left out; answers are checked again on the device.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const O = require(path.join(__dirname, "..", "music/open.js"));
const q = (u) => new URL(u).searchParams;

test("normFilter keeps only known values", () => {
  const F = O.normFilter({ g: "jazz", cc: "gr", dur: "m", pd: true, com: 1, mod: "yes", y0: 2010, y1: 1999, vi: "i",
    mood: "happy", sp: "high", gd: "female", ae: "acoustic", sort: "new", off: 1, x: "<img>" });
  assert.deepEqual(F, { g: "jazz", cc: "GR", dur: "m", pd: 1, com: 1, y0: 1999, y1: 2010, vi: "i", mood: "happy", sp: "high",
    gd: "female", ae: "acoustic", sort: "new", off: 1 });
  assert.deepEqual(O.normFilter({ g: "nope", cc: "XX", dur: "z", y0: 12, vi: "q", mood: "x", sp: "warp", gd: "x", ae: "x", sort: "x" }), {});
  assert.deepEqual(O.normFilter(null), {});
  assert.equal(O.filterOn({ sort: "pop" }), false);
  assert.equal(O.filterOn({ com: 1 }), true);
  assert.deepEqual(O.groupsOf({ y1: 2000, mod: 1, g: "rock" }), ["g", "lic", "y"]);
  assert.equal(O.filterSig({ g: "rock", cc: "de" }), O.filterSig({ cc: "DE", g: "rock" }));
});

test("country codes: alpha-3 for Jamendo, English name for Internet Archive", () => {
  assert.equal(O.cc3("GR"), "GRC");
  assert.equal(O.cc3("de"), "DEU");
  assert.equal(O.cc3("ZZ"), "");
  assert.equal(O.countryEn("GR"), "Greece");
  assert.ok(O.countryCodes().length > 240);
  assert.match(O.jmCountryUrl("GR"), /artists\/locations\/\?.*location_country=GRC/);
  assert.deepEqual(O.jmParseIds({ headers: { status: "success" }, results: [{ id: "1510" }, { id: "x" }, { id: 7 }] }), ["1510", "7"]);
});

test("which source honours which filter", () => {
  assert.deepEqual(O.filterMissing("jm", { g: "rock", cc: "GR", dur: "s", com: 1, y0: 2000, vi: "v", mood: "sad", sp: "low", gd: "male", ae: "electric" }), []);
  assert.deepEqual(O.filterMissing("jm", { pd: 1 }), ["lic"]);          // no public domain on Jamendo
  assert.deepEqual(O.filterMissing("jm", { off: 1 }), ["off"]);         // streaming only
  assert.deepEqual(O.filterMissing("ia", { dur: "s", g: "jazz", cc: "GR" }), ["dur"]);
  assert.deepEqual(O.filterMissing("ov", { cc: "GR", y0: 2000 }), ["cc", "y"]);
  assert.deepEqual(O.filterMissing("cc", { vi: "i" }), []);
  assert.deepEqual(O.filterMissing("cc", { vi: "v" }), ["vi"]);
  assert.deepEqual(O.filterMissing("loc", { g: "rock", dur: "l", y0: 1990 }), []);
  assert.deepEqual(O.filterMissing("loc", { com: 1, mood: "happy" }), ["lic", "mood"]);
  assert.deepEqual(O.filterMissing("jm", { sort: "new" }), []);
});

test("Jamendo address carries every filter", () => {
  const p = q(O.jmTracksUrl({ q: "piano", f: { g: "jazz", dur: "m", y0: 2001, y1: 2010, vi: "i", mood: "relaxed", sp: "low", gd: "female", ae: "acoustic", com: 1, sort: "new" }, artists: ["1510", "x", "606765"] }));
  assert.equal(p.get("search"), "piano");
  assert.equal(p.get("tags"), "jazz");
  assert.equal(p.get("fuzzytags"), "relaxed");
  assert.equal(p.get("durationbetween"), "120_300");
  assert.equal(p.get("datebetween"), "2001-01-01_2010-12-31");
  assert.equal(p.get("vocalinstrumental"), "instrumental");
  assert.equal(p.get("speed"), "low");
  assert.equal(p.get("gender"), "female");
  assert.equal(p.get("acousticelectric"), "acoustic");
  // Jamendo answers ccnc / ccnd only as a pair.
  assert.equal(p.get("ccnc"), "false");
  assert.equal(p.get("ccnd"), "false");
  assert.equal(p.get("order"), "releasedate_desc");
  assert.equal(p.get("artist_id"), "1510+606765");
  assert.equal(p.get("lang"), null);   // Jamendo's lang filter answers "Internal Error"
  const plain = q(O.jmTracksUrl({ q: "piano" }));
  assert.equal(plain.get("ccnc"), null);
  assert.equal(plain.get("order"), null);
});

test("Internet Archive, Openverse and ccMixter addresses", () => {
  const ia = decodeURIComponent(O.iaSearchUrl({ q: "live", f: { g: "hiphop", cc: "GR", y0: 1990, pd: 1, sort: "new" } }));
  assert.match(ia, /subject:\(hip hop\)/);
  assert.match(ia, /coverage:\(Greece\)/);
  assert.match(ia, /year:\[1990 TO 2100\]/);
  assert.match(ia, /licenseurl:\(\*publicdomain\*\)/);
  assert.match(ia, /-collection:\(78rpm/);
  assert.match(ia, /sort\[\]=publicdate desc/);
  const ov = q(O.ovUrl({ q: "piano", f: { g: "jazz", dur: "s", com: 1, mod: 1 } }));
  assert.equal(ov.get("q"), "piano jazz");
  assert.equal(ov.get("license_type"), "commercial,modification");
  assert.equal(ov.get("length"), "shortest,short");
  assert.equal(q(O.ovUrl({ f: { pd: 1, com: 1 } })).get("license"), "cc0,pdm");
  assert.equal(q(O.ovUrl({ creator: "X", f: { g: "rock" } })).get("q"), null);
  const cc = q(O.ccUrl({ f: { g: "hiphop", vi: "i", com: 1, sort: "new" } }));
  assert.equal(cc.get("tags"), "hip_hop,instrumental");
  assert.equal(cc.get("lic"), "by");
  assert.equal(cc.get("sort"), "date");
  assert.equal(q(O.ccUrl({ f: { pd: 1 } })).get("lic"), "pd");
});

test("answers are checked again: licence, length, offline, year", () => {
  assert.equal(O.licOk("by-nc-sa 3.0", { com: 1 }), false);
  assert.equal(O.licOk("by-sa 4.0", { com: 1, mod: 1 }), true);
  assert.equal(O.licOk("by-nd 4.0", { mod: 1 }), false);
  assert.equal(O.licOk("by-nd 4.0", { com: 1 }), true);
  assert.equal(O.licOk("cc0", { pd: 1, com: 1, mod: 1 }), true);
  assert.equal(O.licOk("by 4.0", { pd: 1 }), false);
  assert.equal(O.licOk("lma", { mod: 1 }), false);
  assert.equal(O.licOk("sampling+ 1.0", { com: 1 }), false);
  assert.equal(O.licOk("", { com: 1 }), false);
  assert.equal(O.licOk("", {}), true);
  const r = { k: "jm:x", d: 200, li: "by 3.0" };
  assert.equal(O.trackPasses(r, { dur: "m" }), true);
  assert.equal(O.trackPasses(r, { dur: "s" }), false);
  assert.equal(O.trackPasses({ k: "cc:x", d: 0, li: "by 3.0" }, { dur: "m" }), false);   // unknown length never passes a length filter
  assert.equal(O.trackPasses(r, { off: 1 }), false);
  assert.equal(O.trackPasses(Object.assign({ off: 1 }, r), { off: 1 }), true);
  assert.equal(O.albumPasses({ li: "by-nc 3.0", y: "1999" }, { com: 1 }), false);
  assert.equal(O.albumPasses({ li: "by 3.0", y: "1999" }, { y0: 2000 }), false);
  assert.equal(O.albumPasses({ li: "by 3.0", y: "2004" }, { y0: 2000, y1: 2010 }), true);
});

test("songs on this device: genre in any spelling, year, length", () => {
  const r = { t: "x", g: "Hip-Hop; Soul", y: 2004, d: 250 };
  assert.equal(O.localPasses(r, { g: "hiphop" }), true);
  assert.equal(O.localPasses({ g: "Χιπ χοπ", y: 2004, d: 250 }, { g: "hiphop" }), true);
  assert.equal(O.localPasses({ g: "Ροκ", d: 250 }, { g: "rock" }), true);
  assert.equal(O.localPasses(r, { g: "rock" }), false);
  assert.equal(O.localPasses({ t: "x", d: 250 }, { g: "rock" }), false);
  assert.equal(O.localPasses(r, { y0: 2000, y1: 2005, dur: "m" }), true);
  assert.equal(O.localPasses(r, { y0: 2005 }), false);
  assert.equal(O.localPasses({ t: "x", d: 250 }, { y0: 2000 }), false);
});

test("filter words exist in English, Greek and German", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "music/music.js"), "utf8");
  const keys = [...new Set([...src.matchAll(/"(fl\.[a-zA-Z0-9.]+)": "/g)].map((m) => m[1]))];
  assert.ok(keys.length > 50);
  const used = [...src.matchAll(/t\("(fl\.[a-zA-Z0-9.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith("."));
  used.forEach((k) => assert.ok(keys.includes(k), "missing " + k));
  // dynamic keys
  ["fl.g.g", "fl.g.cc", "fl.g.dur", "fl.g.lic", "fl.g.y", "fl.g.vi", "fl.g.mood", "fl.g.sp", "fl.g.gd", "fl.g.ae", "fl.g.off",
    "fl.dur.s", "fl.dur.xl", "fl.sp.verylow", "fl.sp.veryhigh", "fl.gd.male", "fl.ae.electric"].forEach((k) => assert.ok(keys.includes(k), k));
  const count = (k) => (src.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length;
  keys.forEach((k) => assert.equal(count(k), 2, k + " in EN and EL"));
  let de = null;
  global.orosPack = (l, a, o) => { de = o; };
  require(path.join(__dirname, "..", "i18n/de/music.js"));
  keys.forEach((k) => assert.ok(de[k], "DE " + k));
});
