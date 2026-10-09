// designkit/media.js: licences, request URLs, response parsers of
// every source, the search runner (cache, errors), credits, text
// and URL hygiene, the SVG sanitizer and downloads.
// Run: node --test tests/
//
// The sample responses follow each API's published format; they are
// written here by hand, not recorded from the live services.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "designkit/media.js"));

// ---------- samples ----------

const OPENVERSE_IMAGES = {
  result_count: 3, page_count: 2, page_size: 24, page: 1,
  results: [
    { id: "a1", title: "Santorini sunset", foreign_landing_url: "https://www.flickr.com/photos/x/1",
      url: "https://live.staticflickr.com/1/1_b.jpg", creator: "Maria", creator_url: "https://www.flickr.com/people/maria",
      license: "by", license_version: "2.0", license_url: "https://creativecommons.org/licenses/by/2.0/",
      provider: "flickr", source: "flickr", category: "photograph", filetype: "jpg", width: 1024, height: 683,
      thumbnail: "https://api.openverse.org/v1/images/a1/thumb/" },
    { id: "a2", title: "Olive tree", foreign_landing_url: "https://commons.wikimedia.org/wiki/File:Olive.jpg",
      url: "https://upload.wikimedia.org/olive.jpg", creator: null, creator_url: null,
      license: "cc0", license_version: "1.0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
      width: 800, height: 600, thumbnail: "https://api.openverse.org/v1/images/a2/thumb/" },
    { id: "a3", title: "No commercial", foreign_landing_url: "https://example.org/3", url: "https://example.org/3.jpg",
      creator: "Nick", license: "by-nc", license_version: "4.0", width: 10, height: 10,
      thumbnail: "https://api.openverse.org/v1/images/a3/thumb/" }
  ]
};

const OPENVERSE_AUDIO = {
  result_count: 1, page_count: 1,
  results: [{ id: "s1", title: "Rain on roof", foreign_landing_url: "https://freesound.org/s/1/",
    url: "https://cdn.freesound.org/previews/1.mp3", creator: "Ana", license: "cc0", license_version: "1.0",
    filetype: "mp3", duration: 61500, thumbnail: null }]
};

const COMMONS = {
  batchcomplete: true,
  continue: { gsroffset: 24, continue: "gsroffset||" },
  query: { pages: [
    { pageid: 2, ns: 6, title: "File:Acropolis at night.jpg", index: 2, imageinfo: [{
      url: "https://upload.wikimedia.org/a/ab/Acropolis.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Acropolis.jpg",
      thumburl: "https://upload.wikimedia.org/thumb/a/ab/Acropolis.jpg/480px-Acropolis.jpg",
      width: 4000, height: 3000, mime: "image/jpeg",
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
        Artist: { value: "<a href=\"//commons.wikimedia.org/wiki/User:Nikos\" title=\"User:Nikos\">Nikos &amp; Co</a>" },
        ObjectName: { value: "Acropolis at night" } } }] },
    { pageid: 1, ns: 6, title: "File:Old map.png", index: 1, imageinfo: [{
      url: "https://upload.wikimedia.org/o/old.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:Old_map.png",
      thumburl: "https://upload.wikimedia.org/thumb/o/old.png/480px-old.png", width: 900, height: 700, mime: "image/png",
      extmetadata: { LicenseShortName: { value: "Public domain" }, Artist: { value: "Unknown author" } } }] },
    { pageid: 3, ns: 6, title: "File:Gfdl only.jpg", index: 3, imageinfo: [{
      url: "https://upload.wikimedia.org/g/g.jpg", thumburl: "https://upload.wikimedia.org/g/t.jpg", width: 1, height: 1,
      extmetadata: { LicenseShortName: { value: "GFDL" } } }] }
  ] }
};

const ICONIFY = {
  icons: ["mdi:home", "tabler:heart", "gplset:star", "bad id!"],
  total: 3, limit: 96, start: 0,
  collections: {
    mdi: { name: "Material Design Icons", author: { name: "Pictogrammers", url: "https://github.com/Templarian/MaterialDesign" },
           license: { title: "Apache 2.0", spdx: "Apache-2.0", url: "https://github.com/Templarian/MaterialDesign/blob/master/LICENSE" } },
    tabler: { name: "Tabler Icons", author: { name: "Paweł Kuna" }, license: { title: "MIT", spdx: "MIT" } },
    gplset: { name: "Some GPL set", license: { title: "GPL 3.0", spdx: "GPL-3.0" } }
  }
};

const FONTS = [
  { id: "roboto", family: "Roboto", subsets: ["greek", "latin"], weights: [100, 400, 700, 950], styles: ["normal", "italic"], category: "sans-serif" },
  { id: "gfs-didot", family: "GFS Didot", subsets: ["greek", "latin"], weights: [400], styles: ["normal"], category: "serif" },
  { id: "comfortaa", family: "Comfortaa", subsets: ["greek", "latin"], weights: [300, 400, 700], styles: ["normal"], category: "display" },
  { id: "Bad Id", family: "Broken", subsets: [] }
];

const FONT_DETAIL = {
  id: "gfs-didot", family: "GFS Didot",
  variants: { "400": { normal: {
    latin: { url: { woff2: "https://cdn.jsdelivr.net/fontsource/fonts/gfs-didot@latest/latin-400-normal.woff2",
                    ttf: "https://cdn.jsdelivr.net/fontsource/fonts/gfs-didot@latest/latin-400-normal.ttf" } },
    greek: { url: { woff2: "https://cdn.jsdelivr.net/fontsource/fonts/gfs-didot@latest/greek-400-normal.woff2",
                    ttf: "https://cdn.jsdelivr.net/fontsource/fonts/gfs-didot@latest/greek-400-normal.ttf" } },
    "bad subset!": { url: { ttf: "https://x.org/a.ttf" } } } } }
};

const PIXABAY = { total: 500, totalHits: 30, hits: [
  { id: 7, pageURL: "https://pixabay.com/photos/sea-7/", tags: "sea, blue", previewURL: "https://cdn.pixabay.com/p_150.jpg",
    webformatURL: "https://pixabay.com/get/w_640.jpg", largeImageURL: "https://pixabay.com/get/l_1280.jpg",
    imageWidth: 4000, imageHeight: 2600, user: "Kostas" }] };

const PIXABAY_VIDEO = { totalHits: 1, hits: [{ id: 9, pageURL: "https://pixabay.com/videos/waves-9/", tags: "waves", duration: 12,
  videos: { medium: { url: "https://cdn.pixabay.com/video/m.mp4", width: 1920, height: 1080, thumbnail: "https://cdn.pixabay.com/video/m.jpg" } },
  user: "Eleni" }] };

const PEXELS = { page: 1, per_page: 24, total_results: 2, next_page: "https://api.pexels.com/v1/search?page=2",
  photos: [{ id: 11, width: 3000, height: 2000, url: "https://www.pexels.com/photo/11/", photographer: "Giannis",
    photographer_url: "https://www.pexels.com/@giannis", alt: "Boat in a harbour",
    src: { original: "https://images.pexels.com/11.jpeg", large2x: "https://images.pexels.com/11.jpeg?w=1880",
           medium: "https://images.pexels.com/11.jpeg?h=350" } }] };

const PEXELS_VIDEO = { total_results: 1, videos: [{ id: 21, url: "https://www.pexels.com/video/21/", image: "https://images.pexels.com/v21.jpg",
  duration: 8, user: { name: "Dimitra", url: "https://www.pexels.com/@dimitra" },
  video_files: [
    { link: "https://videos.pexels.com/21-sd.mp4", file_type: "video/mp4", width: 640, height: 360 },
    { link: "https://videos.pexels.com/21-hd.mp4", file_type: "video/mp4", width: 1280, height: 720 },
    { link: "https://videos.pexels.com/21-4k.mp4", file_type: "video/mp4", width: 3840, height: 2160 }] }] };

// ---------- licences ----------

test("licences: each source's wording maps to one licence code", () => {
  const n = (s, raw) => M.normLicense(s, raw);
  assert.deepEqual(n("openverse", "by-sa"), { lic: "by-sa", ver: "" });
  assert.deepEqual(n("openverse", "pdm"), { lic: "pdm", ver: "" });
  assert.deepEqual(n("openverse", "sampling+"), { lic: "other", ver: "" });
  assert.deepEqual(n("openverse", "constructor"), { lic: "other", ver: "" });
  assert.deepEqual(n("commons", "CC BY-SA 4.0"), { lic: "by-sa", ver: "4.0" });
  assert.deepEqual(n("commons", "CC BY 2.5 dk"), { lic: "by", ver: "2.5" });
  assert.deepEqual(n("commons", "CC BY-NC-ND 3.0"), { lic: "by-nc-nd", ver: "3.0" });
  assert.deepEqual(n("commons", "CC0"), { lic: "cc0", ver: "" });
  assert.deepEqual(n("commons", "Public domain"), { lic: "pdm", ver: "" });
  assert.deepEqual(n("commons", "GFDL"), { lic: "other", ver: "" });
  assert.deepEqual(n("commons", "FAL"), { lic: "other", ver: "" });
  assert.deepEqual(n("iconify", "MIT"), { lic: "permissive", ver: "" });
  assert.deepEqual(n("iconify", "Apache-2.0"), { lic: "permissive", ver: "" });
  assert.deepEqual(n("iconify", "OFL-1.1"), { lic: "permissive", ver: "" });
  assert.deepEqual(n("iconify", "CC-BY-4.0"), { lic: "by", ver: "4.0" });
  assert.deepEqual(n("iconify", "CC-BY-SA-3.0"), { lic: "by-sa", ver: "3.0" });
  assert.deepEqual(n("iconify", "CC-BY-NC-4.0"), { lic: "by-nc", ver: "4.0" });
  assert.deepEqual(n("iconify", "GPL-3.0"), { lic: "other", ver: "" });
  assert.deepEqual(n("pixabay"), { lic: "pixabay", ver: "" });
  assert.deepEqual(n("pexels"), { lic: "pexels", ver: "" });
  assert.deepEqual(n("fontsource"), { lic: "font", ver: "" });
});

test("licences: labels carry the version, policy hides NC / ND / other", () => {
  assert.equal(M.licenseOf("by-sa", "4.0").label, "CC BY-SA 4.0");
  assert.equal(M.licenseOf("by-sa", "4.0").url, "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(M.licenseOf("cc0", "1.0").label, "CC0");
  assert.equal(M.licenseOf("nope"), null);
  for (const code of ["cc0", "pdm", "by", "by-sa", "permissive", "pixabay", "pexels", "font"])
    assert.ok(M.allowed({ lic: code }), code);
  for (const code of ["by-nc", "by-nd", "by-nc-sa", "by-nc-nd", "other"]) {
    assert.ok(!M.allowed({ lic: code }), code);
    assert.ok(M.allowed({ lic: code }, { restricted: true }), code + " restricted");
  }
  assert.ok(!M.allowed({ lic: "unknown" }, { restricted: true }));
  assert.ok(!M.allowed(null));
});

// ---------- requests ----------

test("requests: URLs, keys kept out of the cache key, empty queries refused", () => {
  const ov = M.request("openverse", "photo", "  ηλιοβασίλεμα   σαντορίνη ", { page: 2 });
  assert.match(ov.url, /^https:\/\/api\.openverse\.org\/v1\/images\/\?/);
  assert.match(ov.url, /q=%CE%B7/);
  assert.match(ov.url, /page=2/);
  assert.match(ov.url, /license_type=commercial%2Cmodification/);
  assert.match(ov.url, /category=photograph/);
  assert.match(ov.url, /mature=false/);
  assert.doesNotMatch(M.request("openverse", "photo", "x", { restricted: true }).url, /license_type/);
  assert.match(M.request("openverse", "audio", "rain").url, /\/v1\/audio\/\?/);

  const cm = M.request("commons", "video", "Athens", { page: 3 });
  assert.match(cm.url, /origin=\*/);
  assert.match(cm.url, /gsrsearch=Athens%20filetype%3Avideo/);
  assert.match(cm.url, /gsroffset=48/);

  assert.equal(M.request("pixabay", "photo", "sea", {}), null);          // no key
  const px = M.request("pixabay", "photo", "sea", { key: "SECRET", lang: "el" });
  assert.match(px.url, /key=SECRET/);
  assert.doesNotMatch(px.cacheKey, /SECRET/);
  assert.match(px.url, /lang=el/);
  assert.match(M.request("pixabay", "video", "sea", { key: "k" }).url, /^https:\/\/pixabay\.com\/api\/videos\//);

  const pe = M.request("pexels", "photo", "boat", { key: "PK" });
  assert.equal(pe.headers.Authorization, "PK");
  assert.doesNotMatch(pe.url, /PK/);

  assert.equal(M.request("openverse", "photo", "   ", {}), null);
  assert.equal(M.request("openverse", "video", "x", {}), null);           // kind not offered
  assert.equal(M.request("nowhere", "photo", "x", {}), null);
  assert.ok(M.request("fontsource", "font", "", {}));                    // catalog needs no query
  assert.match(M.request("fontsource", "font", "", {}).url, /subsets=greek/);
  assert.doesNotMatch(M.request("fontsource", "font", "", { greek: false }).url, /subsets/);
});

test("sources: which sources can search a kind (keyed ones only with a key)", () => {
  assert.deepEqual(M.sourcesFor("photo", {}), ["openverse", "commons"]);
  assert.deepEqual(M.sourcesFor("video", { pixabay: "k", pexels: " " }), ["commons", "pixabay"]);
  assert.deepEqual(M.sourcesFor("icon"), ["iconify"]);
  assert.deepEqual(M.sourcesFor("font"), ["fontsource"]);
  assert.deepEqual(M.sourcesFor("audio"), ["openverse", "commons"]);
});

// ---------- parsers ----------

test("parse: Openverse images keep licence and credit fields; NC hidden by default", () => {
  const r = M.parse("openverse", "photo", OPENVERSE_IMAGES, { page: 1 });
  assert.equal(r.items.length, 2);
  assert.equal(r.total, 3);
  assert.equal(r.more, true);
  const a = r.items[0];
  assert.equal(a.id, "openverse:a1");
  assert.equal(a.lic, "by");
  assert.equal(a.licVer, "2.0");
  assert.equal(a.author, "Maria");
  assert.equal(a.thumb, "https://api.openverse.org/v1/images/a1/thumb/");
  assert.equal(a.w, 1024);
  assert.equal(r.items[1].author, "");
  const all = M.parse("openverse", "photo", OPENVERSE_IMAGES, { restricted: true });
  assert.equal(all.items.length, 3);
});

test("parse: Openverse audio duration in seconds, no thumbnail needed", () => {
  const r = M.parse("openverse", "audio", OPENVERSE_AUDIO, {});
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].dur, 61.5);
  assert.equal(r.items[0].mime, "audio/mp3");
  assert.equal(r.more, false);
});

test("parse: Commons HTML author becomes text, order by search rank, GFDL hidden", () => {
  const r = M.parse("commons", "photo", COMMONS, {});
  assert.deepEqual(r.items.map((i) => i.id), ["commons:1", "commons:2"]);
  const acro = r.items[1];
  assert.equal(acro.author, "Nikos & Co");
  assert.equal(acro.title, "Acropolis at night");
  assert.equal(acro.lic, "by-sa");
  assert.equal(acro.licVer, "4.0");
  assert.equal(r.items[0].title, "Old map");
  assert.equal(r.items[0].lic, "pdm");
  assert.equal(r.more, true);
  assert.equal(M.parse("commons", "photo", COMMONS, { restricted: true }).items.length, 3);
  // formatversion 1 (pages as an object) is read too
  const v1 = { query: { pages: { "2": COMMONS.query.pages[0] } } };
  assert.equal(M.parse("commons", "photo", v1, {}).items.length, 1);
});

test("parse: Iconify icons carry their set's licence; GPL and bad ids dropped", () => {
  const r = M.parse("iconify", "icon", ICONIFY, {});
  assert.deepEqual(r.items.map((i) => i.id), ["iconify:mdi:home", "iconify:tabler:heart"]);
  assert.equal(r.items[0].full, "https://api.iconify.design/mdi/home.svg");
  assert.equal(r.items[0].lic, "permissive");
  assert.equal(r.items[0].author, "Pictogrammers");
  assert.equal(r.items[1].title, "heart");
});

test("parse: Fontsource catalog is filtered, sorted and paged locally", () => {
  const all = M.parse("fontsource", "font", FONTS, {});
  assert.deepEqual(all.items.map((f) => f.family), ["Comfortaa", "GFS Didot", "Roboto"]);
  assert.equal(all.total, 3);
  const rob = all.items[2];
  assert.deepEqual(rob.weights, [100, 400, 700]);
  assert.deepEqual(rob.styles, ["normal", "italic"]);
  assert.equal(rob.greek, true);
  assert.equal(rob.lic, "font");
  assert.deepEqual(M.parse("fontsource", "font", FONTS, { q: "didot" }).items.map((f) => f.id), ["fontsource:gfs-didot"]);
  assert.deepEqual(M.parse("fontsource", "font", FONTS, { q: "serif" }).items.map((f) => f.id), ["fontsource:gfs-didot", "fontsource:roboto"]);
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ id: "f" + String(i).padStart(2, "0"), family: "F" + String(i).padStart(2, "0"), subsets: ["greek"] });
  const p2 = M.parse("fontsource", "font", many, { page: 2 });
  assert.equal(p2.items.length, 6);
  assert.equal(p2.more, false);
  assert.equal(M.parse("fontsource", "font", many, { page: 1 }).more, true);
});

test("fontFiles: per-subset TTF + WOFF2 of one weight and style", () => {
  const f = M.fontFiles(FONT_DETAIL, 400, "normal");
  assert.deepEqual(Object.keys(f), ["greek", "latin"]);
  assert.match(f.greek.ttf, /greek-400-normal\.ttf$/);
  assert.deepEqual(M.fontFiles(FONT_DETAIL, 700, "normal"), {});
  assert.deepEqual(M.fontFiles(null, 400), {});
});

test("parse: Pixabay and Pexels photos and videos", () => {
  const px = M.parse("pixabay", "photo", PIXABAY, { page: 1 });
  assert.equal(px.items[0].full, "https://pixabay.com/get/l_1280.jpg");
  assert.equal(px.items[0].author, "Kostas");
  assert.equal(px.items[0].lic, "pixabay");
  assert.equal(px.more, true);
  const pv = M.parse("pixabay", "video", PIXABAY_VIDEO, {});
  assert.equal(pv.items[0].kind, "video");
  assert.equal(pv.items[0].dur, 12);
  assert.equal(pv.items[0].mime, "video/mp4");
  const pe = M.parse("pexels", "photo", PEXELS, {});
  assert.equal(pe.items[0].title, "Boat in a harbour");
  assert.equal(pe.items[0].full, "https://images.pexels.com/11.jpeg?w=1880");
  assert.equal(pe.more, true);
  const vv = M.parse("pexels", "video", PEXELS_VIDEO, {});
  assert.equal(vv.items[0].full, "https://videos.pexels.com/21-hd.mp4", "the smallest file at least 960 wide");
  assert.equal(vv.items[0].author, "Dimitra");
});

test("parse: garbage in gives an empty list, never a throw", () => {
  for (const src of Object.keys(M.SOURCES)) {
    for (const j of [null, undefined, 42, "x", [], {}, { results: "no" }, { hits: [null] }, { query: { pages: [{}] } }]) {
      const kind = M.SOURCES[src].kinds[0];
      const r = M.parse(src, kind, j, {});
      assert.ok(Array.isArray(r.items), src);
    }
  }
});

test("parse: unsafe URLs are cleared and the result is dropped", () => {
  const bad = JSON.parse(JSON.stringify(OPENVERSE_IMAGES));
  bad.results[0].url = "javascript:alert(1)";
  bad.results[1].url = "http://plain.example/x.jpg";
  bad.results[1].creator_url = "https://user:pw@evil.example/";
  const r = M.parse("openverse", "photo", bad, { restricted: true });
  assert.deepEqual(r.items.map((i) => i.id), ["openverse:a3"]);
});

// ---------- hygiene ----------

test("cleanText: tags, scripts, entities, control characters, length", () => {
  assert.equal(M.cleanText("<b>Hi</b> <script>alert(1)</script>there &amp; &#x3b1;&#946;"), "Hi there & αβ");
  assert.equal(M.cleanText("a\u0000b‮c\n\td"), "a b c d");
  assert.equal(M.cleanText("x".repeat(300)).length, 200);
  assert.equal(M.cleanText(null), "");
  assert.equal(M.cleanText("&#0; &#xD800; &bogus;"), "&bogus;");
});

test("safeUrl: https only, no credentials, no port, no quotes", () => {
  assert.equal(M.safeUrl("https://Example.org/a?b=1"), "https://example.org/a?b=1");
  assert.equal(M.safeUrl("//upload.wikimedia.org/x.png"), "https://upload.wikimedia.org/x.png");
  assert.equal(M.safeUrl("https://example.org"), "https://example.org/");
  for (const u of ["http://example.org/", "javascript:alert(1)", "data:image/png;base64,AA", "https://a:b@example.org/",
                   "https://example.org:8443/", "https://example.org/a\"b", "https://..evil/", "https://exa mple.org/", 7, null])
    assert.equal(M.safeUrl(u), "", String(u));
});

// ---------- search runner ----------

function fakeRes(status, body, headers) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] || null },
    json: () => (typeof body === "string" ? Promise.reject(new Error("bad json")) : Promise.resolve(body))
  };
}

function memCache() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) || null, put: async (k, v) => { m.set(k, v); } };
}

test("search: fetches once, then serves the cache for 24 h", async () => {
  let calls = 0, lastOpts;
  const cache = memCache();
  let now = 1000;
  const env = { cache, now: () => now, fetch: async (url, o) => { calls++; lastOpts = o; return fakeRes(200, OPENVERSE_IMAGES); } };
  const a = await M.search("openverse", "photo", "sunset", {}, env);
  assert.equal(a.items.length, 2);
  assert.equal(lastOpts.credentials, "omit");
  assert.equal(lastOpts.referrerPolicy, "no-referrer");
  await new Promise((r) => setImmediate(r));
  now += 3600e3;
  const b = await M.search("openverse", "photo", "sunset", {}, env);
  assert.equal(b.items.length, 2);
  assert.equal(calls, 1);
  now += 24 * 3600e3;
  await M.search("openverse", "photo", "sunset", {}, env);
  assert.equal(calls, 2);
});

test("search: errors are values (rate, key, server, format, offline) and a stale copy beats offline", async () => {
  const run = (res, extra) => M.search("openverse", "photo", "x", {}, Object.assign({ fetch: async () => res }, extra));
  assert.equal((await run(fakeRes(429, {}))).error, "rate");
  assert.equal((await run(fakeRes(403, {}))).error, "key");
  assert.equal((await run(fakeRes(500, {}))).error, "server");
  assert.equal((await run(fakeRes(200, "not json"))).error, "format");
  const off = await M.search("openverse", "photo", "x", {}, { fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(off.error, "offline");
  assert.deepEqual(off.items, []);
  const cache = memCache();
  const key = M.request("openverse", "photo", "x", {}).cacheKey;
  cache.m.set(key, { t: 0, json: OPENVERSE_IMAGES });
  const stale = await M.search("openverse", "photo", "x", {}, { cache, now: () => 99 * 24 * 3600e3, fetch: async () => { throw new Error("x"); } });
  assert.equal(stale.items.length, 2);
  assert.equal(stale.error, undefined);
  assert.equal((await M.search("openverse", "photo", "x", {}, {})).error, "offline");
  assert.equal((await M.search("pixabay", "photo", "x", {}, { fetch: async () => fakeRes(200, PIXABAY) })).error, "key");
  const withKey = await M.search("pixabay", "photo", "x", {}, { keys: { pixabay: "k" }, fetch: async () => fakeRes(200, PIXABAY) });
  assert.equal(withKey.items.length, 1);
  const broken = memCache();
  broken.get = async () => { throw new Error("cache gone"); };
  broken.put = async () => { throw new Error("cache gone"); };
  assert.equal((await M.search("openverse", "photo", "x", {}, { cache: broken, fetch: async () => fakeRes(200, OPENVERSE_IMAGES) })).items.length, 2);
});

// ---------- credits ----------

test("credits: EN and EL lines, required ones first, deduped", () => {
  const items = M.parse("openverse", "photo", OPENVERSE_IMAGES, { restricted: true }).items
    .concat(M.parse("pixabay", "photo", PIXABAY, {}).items);
  assert.equal(M.credit(items[0], "en"), "“Santorini sunset” by Maria, CC BY 2.0, via Openverse");
  assert.equal(M.credit(items[0], "el"), "«Santorini sunset», δημιουργός: Maria, CC BY 2.0, μέσω Openverse");
  assert.equal(M.credit(items[1], "en"), "“Olive tree”, CC0, via Openverse");
  const font = M.parse("fontsource", "font", FONTS, {}).items[1];
  assert.equal(M.credit(font, "en"), "“GFS Didot”, via Fontsource");
  const lines = M.credits(items.concat([items[0]]), "en");
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.slice(0, 2), ["“No commercial” by Nick, CC BY-NC 4.0, via Openverse",
                                       "“Santorini sunset” by Maria, CC BY 2.0, via Openverse"]);
  assert.equal(M.credit({ src: "evil" }, "en"), "");
});

test("normCredit: canonical, clipped, refuses foreign ids and unknown licences", () => {
  const it = M.parse("commons", "photo", COMMONS, {}).items[1];
  const c = M.normCredit(it);
  assert.deepEqual(Object.keys(c), ["src", "id", "kind", "title", "author", "authorUrl", "page", "lic", "licVer", "licUrl"]);
  assert.deepEqual(M.normCredit(c), c, "idempotent");
  assert.equal(M.normCredit(Object.assign({}, c, { id: "openverse:1" })), null);
  assert.equal(M.normCredit(Object.assign({}, c, { lic: "mine" })), null);
  assert.equal(M.normCredit(Object.assign({}, c, { kind: "exe" })), null);
  assert.equal(M.normCredit(Object.assign({}, c, { page: "javascript:x" })).page, "");
  assert.equal(M.normCredit(Object.assign({}, c, { licVer: "x" })).licVer, "");
  assert.equal(M.normCredit(Object.assign({}, c, { title: "<i>" + "t".repeat(400) })).title.length, 200);
});

// ---------- SVG sanitizer ----------

test("sanitizeSvg: keeps drawing, drops scripts, handlers and outside links", () => {
  const evil = `<?xml version="1.0"?>
<!-- comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50" onload="alert(1)">
  <script>alert(1)</script>
  <script><![CDATA[ alert(2) ]]></script>
  <style>circle{fill:url(https://evil/x)}</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <a href="https://evil.example/"><rect x="1" y="2" width="3" height="4" fill="url(#g)"/></a>
  <circle cx="5" cy="5" r="4" fill="url(https://evil/x)" stroke="#000" ONCLICK="alert(3)"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(4)"/></div></foreignObject>
  <use xlink:href="#g"/><use href="https://evil/sprite.svg#a"/>
  <image href="https://evil/pixel.png" width="1" height="1"/>
  <path d="M0 0L10 10" style="fill:red;stroke:url(javascript:alert(5));behavior:url(x.htc);opacity:.5"/>
  <sodipodi:namedview id="nv"><inkscape:grid/></sodipodi:namedview>
  <animate attributeName="href" to="javascript:alert(6)"/>
  <g transform="translate(1 2)"><polygon points="0,0 1,1 1,0"/></g>
</svg>`;
  const r = M.sanitizeSvg(evil);
  assert.ok(r);
  const out = r.svg;
  for (const bad of [/script/i, /onload/i, /onclick/i, /alert/, /evil/, /foreignObject/, /<image/, /<style/, /namedview/, /animate/, /behavior/, /javascript/i, /<a\b/])
    assert.doesNotMatch(out, bad, String(bad));
  assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100" height="50">/);
  assert.match(out, /<rect x="1" y="2" width="3" height="4" fill="url\(#g\)"\/>/, "rect kept from inside the link");
  assert.match(out, /<circle cx="5" cy="5" r="4" stroke="#000"\/>/, "outside fill dropped, the rest kept");
  assert.match(out, /<use xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" xlink:href="#g"\/>/);
  assert.match(out, /<use\/>/);
  assert.match(out, /style="fill:red;opacity:.5"/);
  assert.match(out, /<polygon points="0,0 1,1 1,0"\/>/);
  assert.equal(r.w, 100);
  assert.equal(r.h, 50);
  assert.deepEqual(M.sanitizeSvg(out), r, "sanitizing twice changes nothing");
});

test("sanitizeSvg: refuses entity tricks, broken markup and non-SVG", () => {
  const xxe = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>';
  assert.equal(M.sanitizeSvg(xxe), null);
  assert.equal(M.sanitizeSvg('<svg><rect fill="&x;"/></svg>').svg, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  assert.equal(M.sanitizeSvg("<svg><g></svg>"), null);
  assert.equal(M.sanitizeSvg("<svg><rect></svg>"), null);
  assert.equal(M.sanitizeSvg("<html><svg/></html>"), null);
  assert.equal(M.sanitizeSvg("<svg/><svg/>"), null);
  assert.equal(M.sanitizeSvg('<svg width="1"x="2"/>'), null);
  assert.equal(M.sanitizeSvg("<svg><!ELEMENT x></svg>"), null);
  assert.equal(M.sanitizeSvg("<svg><!-- open"), null);
  assert.equal(M.sanitizeSvg("not svg"), null);
  assert.equal(M.sanitizeSvg(""), null);
  assert.equal(M.sanitizeSvg(7), null);
  assert.equal(M.sanitizeSvg("<svg>" + "<g>".repeat(70) + "</g>".repeat(70) + "</svg>"), null, "too deep");
  assert.equal(M.sanitizeSvg("<svg>" + "x".repeat(1024 * 1024) + "</svg>"), null, "too big");
  const v = M.sanitizeSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg viewBox="0 0 24 12"><path d="M1 1"/></svg>');
  assert.equal(v.w, 24);
  assert.equal(v.h, 12);
});

test("sanitizeSvg: attribute values are re-escaped", () => {
  const r = M.sanitizeSvg(`<svg><g id='a&quot;&gt;&lt;x' fill="#0f0"/></svg>`);
  assert.equal(r.svg, '<svg xmlns="http://www.w3.org/2000/svg"><g id="a&quot;&gt;&lt;x" fill="#0f0"/></svg>');
});

// ---------- downloads ----------

function blobRes(status, blob, len) {
  return { ok: status === 200, status, headers: { get: (k) => (k.toLowerCase() === "content-length" && len ? String(len) : null) }, blob: async () => blob };
}

test("fetchMedia: type and size checked, SVG comes back sanitized", async () => {
  const photo = { kind: "photo", full: "https://example.org/a.jpg" };
  const ok = await M.fetchMedia(photo, { fetch: async () => blobRes(200, new Blob(["x"], { type: "image/jpeg" })) });
  assert.equal(ok.type, "image/jpeg");
  await assert.rejects(M.fetchMedia(photo, { fetch: async () => blobRes(200, new Blob(["<html>"], { type: "text/html" })) }), /type/);
  await assert.rejects(M.fetchMedia(photo, { fetch: async () => blobRes(200, new Blob(["x"], { type: "image/jpeg" }), 9e9) }), /size/);
  await assert.rejects(M.fetchMedia(photo, { fetch: async () => blobRes(404, null) }), /server/);
  await assert.rejects(M.fetchMedia(photo, { fetch: async () => { throw new TypeError("net"); } }), /offline/);
  await assert.rejects(M.fetchMedia({ kind: "photo", full: "http://x.org/a.jpg" }, { fetch: async () => blobRes(200, null) }), /offline/);
  const icon = { kind: "icon", full: "https://api.iconify.design/mdi/home.svg" };
  const svg = await M.fetchMedia(icon, { fetch: async () => blobRes(200, new Blob(['<svg viewBox="0 0 24 24" onload="x()"><path d="M1 1"/></svg>'], { type: "image/svg+xml; charset=utf-8" })) });
  assert.equal(await svg.text(), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>');
  await assert.rejects(M.fetchMedia(icon, { fetch: async () => blobRes(200, new Blob(["<svg>"], { type: "image/svg+xml" })) }), /svg/);
  const font = { kind: "font" };
  const ttf = await M.fetchMedia(font, { fetch: async () => blobRes(200, new Blob([new Uint8Array([0, 1, 0, 0])], { type: "font/ttf" })) }, "https://cdn.jsdelivr.net/a.ttf");
  assert.equal(ttf.size, 4);
});
