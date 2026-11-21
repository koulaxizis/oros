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
  const keys = [...new Set([...src.matchAll(/"((?:fl|au|eu|src|dp)\.[a-zA-Z0-9.]+)": "/g)].map((m) => m[1]))];
  assert.ok(keys.length > 50);
  const used = [...src.matchAll(/t\("((?:fl|au|eu|src|dp)\.[a-zA-Z0-9.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith("."));
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

// ---------- MU-SRC (wave 2): Audius and Europeana ----------
const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

test("Audius: addresses, songs, free to listen", () => {
  const s = q(O.auUrl({ q: "piano", f: { g: "hiphop", mood: "sad", sort: "new" }, page: 2 }));
  assert.equal(s.get("app_name"), "orOS");
  assert.equal(s.get("query"), "piano");
  assert.equal(s.get("genre"), "Hip-Hop/Rap");
  assert.equal(s.get("mood"), "Melancholy");
  assert.equal(s.get("sort_method"), "recent");
  assert.equal(s.get("offset"), "20");
  assert.match(O.auUrl({ f: { g: "rock" } }), /\/tracks\/trending\?.*genre=Rock.*time=month/);
  assert.match(O.auUrl({ f: { mood: "happy" } }), /\/tracks\/search\?.*mood=Upbeat/);
  assert.equal(O.auLicence("Attribution-NonCommercial CC BY-NC"), "by-nc");
  assert.equal(O.auLicence("All rights reserved"), "");
  const r = O.auParse({ data: [
    { id: "jZXZa", title: "Time For Jazz", duration: 116, permalink: "/boyjugo/time-for-jazz", license: null, is_streamable: true,
      artwork: { "480x480": "https://cn1.mainnet.audiusindex.org/content/Qm/480x480.jpg" }, user: { name: "BoyJugo", handle: "boyjugo" } },
    { id: "gated1", title: "Paid", duration: 100, is_stream_gated: true, user: { name: "X" } },
    { id: "bad id!", title: "Bad", user: {} },
    { id: "x2", title: "<img src=x>", duration: 200, permalink: "javascript:alert(1)", user: { name: "Y" }, license: "Attribution CC BY" }] });
  assert.equal(r.tracks.length, 2);
  const a = r.tracks[0];
  assert.equal(a.s, "au");
  assert.equal(a.u, "https://discoveryprovider.audius.co/v1/tracks/jZXZa/stream?app_name=orOS");
  assert.equal(a.pg, "https://audius.co/boyjugo/time-for-jazz");
  assert.equal(a.li, undefined);
  assert.equal(a.off, undefined);
  assert.equal(r.tracks[1].pg, "https://audius.co/");
  assert.equal(r.tracks[1].li, "by");
  // Travels in the synced slice like the other open sources.
  assert.equal(C.normRef(a).s, "au");
  assert.equal(C.isRemote(a), true);
  assert.deepEqual(O.filterMissing("au", { com: 1 }), ["lic"]);
  assert.deepEqual(O.filterMissing("au", { off: 1 }), ["off"]);
  assert.deepEqual(O.filterMissing("au", { g: "rock", mood: "dark", dur: "s" }), []);
});

test("Europeana: own key, refinements, open licences only", () => {
  assert.equal(O.euKeyOk("api2demo"), true);
  assert.equal(O.euKeyOk("a b"), false);
  assert.equal(O.euKeyOk(""), false);
  const u = decodeURIComponent(O.euUrl({ q: "rebetiko", key: "mykey123", f: { g: "folk", cc: "GR", y0: 1930, y1: 1960, pd: 1, sort: "new" }, page: 2 }));
  assert.match(u, /^https:\/\/api\.europeana\.eu\/record\/v2\/search\.json\?wskey=mykey123&query=rebetiko folk&qf=TYPE:SOUND&reusability=open&media=true/);
  assert.match(u, /&start=21/);
  assert.match(u, /qf=COUNTRY:"Greece"/);
  assert.match(u, /qf=YEAR:\[1930 TO 1960\]/);
  assert.match(u, /qf=RIGHTS:\*publicdomain\*/);
  assert.match(u, /sort=timestamp_created desc/);
  assert.match(O.euUrl({ key: "k1234" }), /query=\*/);
  const r = O.euParse({ success: true, totalResults: 50, items: [
    { id: "/937/Culturalia_1", title: ["Temă de jazz"], rights: ["http://creativecommons.org/licenses/by-sa/4.0/"],
      edmIsShownBy: ["https://resource.culturalia.ro/a.mp3"], dataProvider: ["Romanian Radio"], year: ["2010"],
      edmPreview: ["https://api.europeana.eu/thumbnail/v2/url.json?uri=x&type=SOUND"] },
    { id: "/2059219/x", title: ["Gallica"], rights: ["http://creativecommons.org/publicdomain/mark/1.0/"], edmIsShownBy: ["http://gallica.bnf.fr/ark:/1/f1.audio"], edmPreview: ["https://evil.example/x.png"] },
    { id: "/1/closed", title: ["Closed"], rights: ["http://rightsstatements.org/vocab/InC/1.0/"], edmIsShownBy: ["https://a.org/x.mp3"] },
    { id: "../bad", title: ["Bad"], rights: ["http://creativecommons.org/licenses/by/4.0/"], edmIsShownBy: ["https://a.org/x.mp3"] }] }, 1);
  assert.equal(r.tracks.length, 2);
  assert.equal(r.more, true);
  assert.equal(r.tracks[0].li, "by-sa 4.0");
  assert.equal(r.tracks[0].a, "Romanian Radio");
  assert.equal(r.tracks[0].pg, "https://www.europeana.eu/item/937/Culturalia_1");
  assert.equal(r.tracks[1].u, "https://gallica.bnf.fr/ark:/1/f1.audio");   // http asked as https
  assert.equal(r.tracks[1].art, undefined);                                  // covers only from Europeana's thumbnails
  assert.equal(C.normRef(r.tracks[0]).s, "eu");
  assert.throws(() => O.euParse({ success: false, error: "Invalid API key" }), (e) => e.code === "key");
  assert.deepEqual(O.filterMissing("eu", { cc: "GR", y0: 1900, pd: 1, g: "folk" }), []);
  assert.deepEqual(O.filterMissing("eu", { dur: "s", off: 1 }), ["dur", "off"]);
  return O.euSearch({ q: "x" }).then(() => assert.fail("no key"), (e) => assert.equal(e.code, "key"));
});

test("sources: order, names, Audius shelf", () => {
  assert.deepEqual(O.SOURCE_ORDER, ["jm", "ia", "fm", "ov", "cc", "km", "au", "mo", "jb", "eu", "dp"]);
  O.SOURCE_ORDER.forEach((s) => assert.ok(O.SOURCES[s].name));
  assert.equal(O.browseOf("autrend").src, "au");
  assert.equal(O.browseName("autrend", "el"), "Δημοφιλή στο Audius");
});

// ---------- MU-SRC2 (wave 2b): FMA, Musopen, National Jukebox, Kevin MacLeod, DPLA ----------
test("Internet Archive collections as sources; the Jukebox only when public domain", () => {
  const now = Date.UTC(2026, 10, 21);
  assert.equal(O.jbLastYear(now), 1925);
  const fm = decodeURIComponent(O.iaSearchUrl({ scope: "fm", q: "jazz" }));
  assert.match(fm, /collection:\(freemusicarchive\)/);
  assert.match(fm, /-collection:\(78rpm/);
  assert.match(decodeURIComponent(O.iaSearchUrl({ scope: "mo" })), /\(collection:\(musopen\) OR subject:\(musopen\)\)/);
  const jb = decodeURIComponent(O.iaSearchUrl({ scope: "jb", now: now }));
  assert.match(jb, /identifier:\(loc-jukebox-\*\) AND licenseurl:\(\*publicdomain\*\) AND year:\[1800 TO 1925\]/);
  assert.doesNotMatch(jb, /78rpm/);
  // A Jukebox card too new for the public domain is dropped; others stay.
  const pdm = "https://creativecommons.org/publicdomain/mark/1.0/";
  const r = O.iaParseSearch({ response: { numFound: 3, docs: [
    { identifier: "loc-jukebox-1-a", title: "A", year: "1923", licenseurl: pdm, collection: ["78rpm"] },
    { identifier: "loc-jukebox-2-b", title: "B", year: "2999", licenseurl: pdm, collection: ["78rpm"] },
    { identifier: "loc-jukebox-3-c", title: "C", licenseurl: pdm, collection: ["78rpm"] }] } }, 1);
  assert.deepEqual(r.albums.map((a) => a.id), ["loc-jukebox-1-a"]);
  assert.equal(O.jbOk("other-item", ""), true);
  // Same rule on the album page.
  const meta = (date, lic) => ({ metadata: { title: "X", date: date, licenseurl: lic, collection: ["78rpm"] },
    files: [{ name: "x.mp3", format: "VBR MP3", source: "original", length: "180" }] });
  assert.ok(O.iaParseMeta(meta("1921", pdm), "loc-jukebox-9-x"));
  assert.equal(O.iaParseMeta(meta("2999", pdm), "loc-jukebox-9-x"), null);
  assert.equal(O.iaParseMeta(meta("1921", "https://creativecommons.org/licenses/by-nc/4.0/"), "loc-jukebox-9-x"), null);
  ["fm", "mo", "jb", "km", "dp"].forEach((s) => assert.ok(O.SOURCES[s].name && O.CAN[s], s));
  ["fma", "kevin", "jukebox", "musopen"].forEach((id) => { assert.ok(O.browseOf(id)); assert.ok(O.browseName(id, "el")); });
});

test("Kevin MacLeod: search and filters on the device", () => {
  const P = [
    { title: "Slow Piano", filename: "Slow Piano.mp3", length: "00:03:10", instruments: "Piano", genre: "4", bpm: "60", description: "Quiet.", feel: "Relaxed, Calming", uploaded: "2015-01-01" },
    { title: "Fast Rock", filename: "Fast Rock.mp3", length: "00:01:30", instruments: "Guitar, Drums", genre: "19", bpm: "160", description: "Loud piano-free.", feel: "Driving, Intense", uploaded: "2020-05-05" },
    { title: "Bad", filename: "../x.wav", length: "00:01:00", genre: "19" },
    { title: "Folk Tune", filename: "Folk Tune.mp3", length: "00:02:30", instruments: "Fiddle", genre: "25", bpm: "100", description: "An old folk dance.", feel: "Bouncy", uploaded: "2010-01-01" }
  ];
  let r = O.kmPick(P, {});
  assert.deepEqual(r.tracks.map((x) => x.t), ["Fast Rock", "Slow Piano", "Folk Tune"]);
  const t0 = r.tracks[1];
  assert.equal(t0.s, "km"); assert.equal(t0.li, "by 4.0"); assert.equal(t0.off, 1); assert.equal(t0.a, "Kevin MacLeod");
  assert.equal(t0.u, "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Slow%20Piano.mp3");
  assert.equal(t0.d, 190); assert.equal(t0.y, 2015);
  assert.deepEqual(O.kmPick(P, { q: "piano" }).tracks.map((x) => x.t), ["Slow Piano", "Fast Rock"]);   // title before description
  assert.deepEqual(O.kmPick(P, { f: { g: "rock" } }).tracks.map((x) => x.t), ["Fast Rock"]);
  assert.deepEqual(O.kmPick(P, { f: { g: "folk" } }).tracks.map((x) => x.t), ["Folk Tune"]);
  assert.deepEqual(O.kmPick(P, { f: { mood: "relaxed" } }).tracks.map((x) => x.t), ["Slow Piano"]);
  assert.deepEqual(O.kmPick(P, { f: { sp: "veryhigh" } }).tracks.map((x) => x.t), ["Fast Rock"]);
  assert.deepEqual(O.kmPick(P, { f: { dur: "s" } }).tracks.map((x) => x.t), ["Fast Rock"]);
  assert.equal(O.kmPick(P, { f: { pd: 1 } }).tracks.length, 0);
  assert.equal(O.kmPick(P, { f: { com: 1, mod: 1, off: 1 } }).tracks.length, 3);
  assert.equal(O.kmSpeed("69"), "verylow"); assert.equal(O.kmSpeed(""), "");
  assert.deepEqual(O.filterMissing("km", { vi: "v" }), ["vi"]);
  assert.deepEqual(O.filterMissing("km", { vi: "i", mood: "romantic" }), ["mood"]);
  const many = Array.from({ length: 45 }, (_, i) => ({ title: "T" + i, filename: "T" + i + ".mp3", length: "00:02:00", genre: "4" }));
  assert.equal(O.kmPick(many, { page: 3 }).tracks.length, 5);
  assert.equal(O.kmPick(many, { page: 2 }).more, true);
});

test("DPLA: own key, sound with open licence, playable files only", () => {
  const K = "0123456789abcdef0123456789abcdef";
  assert.ok(O.dpKeyOk(K)); assert.ok(!O.dpKeyOk("short")); assert.ok(!O.dpKeyOk(K + "x"));
  const p = q(O.dpUrl({ key: K, q: "blues (live)", f: { g: "jazz", cc: "US", y0: 1920, y1: 1950, sort: "new" }, page: 2 }));
  assert.equal(p.get("api_key"), K);
  assert.equal(p.get("sourceResource.type"), "sound");
  assert.equal(p.get("rights"), "*creativecommons*");
  assert.equal(p.get("q"), "blues live jazz");
  assert.equal(p.get("sourceResource.spatial.country"), "United States");
  assert.equal(p.get("sourceResource.date.after"), "1920");
  assert.equal(p.get("sourceResource.date.before"), "1950");
  assert.equal(p.get("sort_by"), "sourceResource.date.begin");
  assert.equal(p.get("page"), "2");
  const doc = (id, extra) => Object.assign({ id: id, rights: "http://creativecommons.org/publicdomain/mark/1.0/",
    sourceResource: { title: ["Song"], creator: "Band", date: { displayDate: "1925", begin: "1925-01-01" } },
    mediaMaster: ["http://archive.example.org/a.mp3"], dataProvider: { name: "Library" } }, extra);
  const r = O.dpParse({ count: 45, docs: [
    doc("a".repeat(32)),
    doc("b".repeat(32), { mediaMaster: ["https://example.org/page.html"] }),
    doc("c".repeat(32), { rights: "http://rightsstatements.org/vocab/InC/1.0/" }),
    doc("bad"), doc("d".repeat(32), { mediaMaster: undefined })] }, 1);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.more, true);
  const t0 = r.tracks[0];
  assert.equal(t0.s, "dp"); assert.equal(t0.u, "https://archive.example.org/a.mp3"); assert.equal(t0.li, "pdm");
  assert.equal(t0.pg, "https://dp.la/item/" + "a".repeat(32)); assert.equal(t0.y, 1925); assert.equal(t0.a, "Band");
  assert.throws(() => O.dpParse({ message: "Invalid or inactive API key." }), (e) => e.code === "key");
  assert.equal(C.isRemote(t0), true);
});

test("Dogmazic preset and new source words exist in English, Greek and German", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "music/music.js"), "utf8");
  let de = null;
  global.orosPack = (l, a, o) => { de = o; };
  delete require.cache[require.resolve(path.join(__dirname, "..", "i18n/de/music.js"))];
  require(path.join(__dirname, "..", "i18n/de/music.js"));
  ["sv.free", "sv.h.dogmazic", "src.fm", "src.km", "src.mo", "src.jb", "src.dp"].forEach((k) => {
    assert.equal((src.match(new RegExp('"' + k.replace(/\./g, "\\.") + '": "', "g")) || []).length, 2, k);
    assert.ok(de[k], "DE " + k);
  });
  assert.match(src, /https:\/\/play\.dogmazic\.net/);
});
