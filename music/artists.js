// ============================================================
// orOS Music — artists.js (well-known artists from open data, v1.0.0)
// Wave 6a of the "known artists" plan (2026-11-04): a page for any
// artist in the world, built only from open data and read straight
// from the browser when the person opens it (never in the
// background), and only while Settings › "Artist pages online" is on:
//   MusicBrainz        artist search, the artist (type, country,
//                      years, genres, members, links), the
//                      discography (release groups) and track lists.
//                      Core data CC0; one request a second (their rule).
//   Cover Art Archive  album covers (each image belongs to its owner).
//   Wikidata           which Wikipedia articles the artist has, and the
//                      Commons photo (P18) when no article has one. CC0.
//   Wikipedia          a short bio in the app language (else English),
//                      text CC BY-SA 4.0, always shown with its link.
//   ListenBrainz       (wave 6c) world charts of the week, fresh
//                      releases and "fans also like" (similar artists).
// What is sent: the search words, the MusicBrainz / Wikidata ids and
// the Wikipedia title. Nothing about the person's music.
// Full songs play only where they are free to play: the person's
// own files and servers, and the open catalogues of open.js (matched
// to MusicBrainz by artist and title). Everything else gets links
// to where it can be heard in full (official site, Bandcamp, stores);
// no previews, no YouTube or other Google links.
// Device cache: IndexedDB "oros-music-meta" (never synced), answers
// kept 1 to 30 days; factory reset deletes it.
// Pure parts (addresses, parsers, matching) run in Node too;
// tests/music-artists.test.js covers them with copied API answers.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosMusicCore || (typeof require === "function" ? require("./core.js").OrosMusicCore : null);
  var MB = "https://musicbrainz.org/ws/2/";
  var MB_GAP = 1100;                       // MusicBrainz: one request a second
  var DAY = 86400000;
  var TTL = { s: DAY, a: 7 * DAY, g: 7 * DAY, r: 30 * DAY, w: 7 * DAY };
  var MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var QID_RE = /^Q[1-9][0-9]{0,11}$/;
  var WIKI_LANGS = ["el", "en", "de"];

  // ---------- 1. Small helpers ----------
  function mbId(v) { return typeof v === "string" && MBID_RE.test(v) ? v : ""; }
  function str(v, max) { return C.clean(typeof v === "number" ? String(v) : v, max); }
  function year(v) { var m = /^(\d{4})/.exec(String(v || "")); return m ? +m[1] : 0; }
  function httpsUrl(u) {
    var s = typeof u === "string" ? u.trim() : "";
    if (/^http:\/\//i.test(s)) s = "https://" + s.slice(7);
    return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000 ? s : "";
  }
  function host(u) { var m = /^https:\/\/([^/?#:]+)/i.exec(u || ""); return m ? m[1].toLowerCase().replace(/^www\./, "") : ""; }
  // Lucene special characters out (the search box is free text).
  function luceneWords(q) {
    return String(q || "").replace(/[\\+\-!(){}[\]^"~*?:/&|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  // Names and titles compared without case, accents, a leading "the",
  // punctuation or "&"/"and".
  function nameKey(s) {
    var k = " " + C.fold(String(s || "").replace(/&/g, " ")).replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
    k = k.replace(/ (and|και|und) /g, " ").replace(/\s+/g, " ").trim();
    return k.replace(/^the /, "");
  }
  // A title without what editions add: "(Remastered 2009)", "[Live]",
  // "- 2011 Remaster", "feat. X".
  function titleKey(s) {
    var t = String(s || "")
      .replace(/\s*[([][^)\]]*(remaster|remix|version|edit|mono|stereo|live|demo|mix|bonus|deluxe|edition|feat|ft\.|with )[^)\]]*[)\]]/gi, "")
      .replace(/\s+-\s+.*(remaster|version|edit|mono|stereo|live|mix).*$/i, "")
      .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, "");
    return nameKey(t) || nameKey(s);
  }
  // Same artist: equal keys once "feat. …" is cut; never a part of a
  // name ("Manos" is not "Manos Hadjidakis").
  function artistKey(a) { return nameKey(String(a || "").replace(/\s+(feat\.?|ft\.?|featuring|with)\s+.*$/i, "")); }
  function sameArtist(a, b) {
    var x = artistKey(a), y = artistKey(b);
    return !!x && x === y;
  }
  function qs(p) {
    return Object.keys(p).filter(function (k) { return p[k] !== "" && p[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k]); }).join("&");
  }

  // ---------- 2. MusicBrainz: search ----------
  function searchUrl(q) {
    var w = luceneWords(q);
    return w ? MB + "artist?" + qs({ query: w, limit: 15, fmt: "json" }) : "";
  }
  function lifeSpan(x) {
    var ls = x && x["life-span"] || {};
    return { b: year(ls.begin), e: year(ls.end), ended: ls.ended === true };
  }
  // The name in the app language when MusicBrainz has it as a primary
  // alias ("Μάνος Χατζιδάκις" for "Manos Hadjidakis" in Greek).
  function localName(x, lang) {
    var l = String(lang || "").slice(0, 2);
    var al = Array.isArray(x && x.aliases) ? x.aliases : [];
    var hit = al.filter(function (a) { return a && a.locale === l && a.primary && a.type !== "Search hint"; })[0];
    return hit ? str(hit.name) : "";
  }
  function artistCard(x, lang) {
    var id = mbId(x && x.id);
    if (!id) return null;
    var ls = lifeSpan(x);
    var o = { id: id, n: str(x.name) || "?", ty: str(x.type, 30), cc: /^[A-Z]{2}$/.test(x.country || "") ? x.country : "", dis: str(x.disambiguation, 120) };
    var ln = localName(x, lang);
    if (ln && ln !== o.n) o.ln = ln;
    if (ls.b) o.b = ls.b;
    if (ls.e) o.e = ls.e;
    if (+x.score >= 0) o.sc = +x.score;
    return o;
  }
  function parseSearch(j, lang) {
    var list = j && Array.isArray(j.artists) ? j.artists : [];
    return list.map(function (x) { return artistCard(x, lang); }).filter(function (a) { return a && (a.sc == null || a.sc >= 50); });
  }

  // ---------- 3. MusicBrainz: one artist ----------
  function artistUrl(id) { return mbId(id) ? MB + "artist/" + id + "?" + qs({ inc: "url-rels+artist-rels+genres+aliases", fmt: "json" }) : ""; }
  // Links worth a tap, by kind. YouTube and other Google services are
  // left out (orOS has no Google dependencies, links included).
  var STORES = [
    ["bandcamp.com", "Bandcamp", "buy"], ["soundcloud.com", "SoundCloud", "listen"], ["open.spotify.com", "Spotify", "listen"],
    ["deezer.com", "Deezer", "listen"], ["music.apple.com", "Apple Music", "listen"], ["itunes.apple.com", "Apple Music", "listen"],
    ["tidal.com", "TIDAL", "listen"], ["listen.tidal.com", "TIDAL", "listen"], ["qobuz.com", "Qobuz", "listen"], ["napster.com", "Napster", "listen"],
    ["music.amazon.com", "Amazon Music", "listen"], ["beatport.com", "Beatport", "buy"], ["7digital.com", "7digital", "buy"],
    ["discogs.com", "Discogs", "info"], ["last.fm", "Last.fm", "info"], ["setlist.fm", "setlist.fm", "info"], ["allmusic.com", "AllMusic", "info"],
    ["songkick.com", "Songkick", "info"], ["genius.com", "Genius", "info"]
  ];
  var BLOCKED = /(^|\.)(youtube\.com|youtu\.be|google\.[a-z.]+|goo\.gl|blogspot\.com)$/;
  function storeOf(h) {
    for (var i = 0; i < STORES.length; i++) {
      var d = STORES[i][0];
      if (h === d || h.slice(-d.length - 1) === "." + d) return STORES[i];
    }
    return null;
  }
  function linkOf(rel) {
    var u = httpsUrl(rel && rel.url && rel.url.resource), ty = String(rel && rel.type || "");
    if (!u) return null;
    var h = host(u);
    if (!h || BLOCKED.test(h)) return null;
    if (ty === "official homepage") return { k: "home", n: h, u: u };
    var st = storeOf(h);
    if (st) return { k: st[2], n: st[1], u: u };
    return null;
  }
  function parseArtist(j, lang) {
    var a = artistCard(j, lang);
    if (!a) return null;
    a.area = str(j.area && j.area.name, 80);
    var gs = Array.isArray(j.genres) ? j.genres.slice() : [];
    gs.sort(function (x, y) { return (+y.count || 0) - (+x.count || 0); });
    a.g = gs.slice(0, 6).map(function (g) { return str(g && g.name, 40); }).filter(Boolean);
    var links = [], seen = {}, members = [], groups = [], wd = "";
    (Array.isArray(j.relations) ? j.relations : []).forEach(function (r) {
      if (!r) return;
      if (r.type === "wikidata") {
        var m = /wikidata\.org\/wiki\/(Q[1-9][0-9]*)$/.exec(r.url && r.url.resource || "");
        if (m && !wd) wd = m[1];
        return;
      }
      if (r["target-type"] === "url") {
        var l = linkOf(r);
        if (l && !seen[l.u] && links.length < 20) { seen[l.u] = 1; links.push(l); }
        return;
      }
      if (r.type === "member of band" && r.artist && mbId(r.artist.id)) {
        var p = { id: r.artist.id, n: str(r.artist.name) || "?", b: year(r.begin), e: year(r.end) };
        if (r.ended) p.past = 1;
        var list = r.direction === "backward" ? members : groups;
        if (!list.some(function (x) { return x.id === p.id; }) && list.length < 40) list.push(p);
      }
    });
    // Official site first, then listen, buy, info.
    var ord = { home: 0, listen: 1, buy: 2, info: 3 };
    links.sort(function (x, y) { return ord[x.k] - ord[y.k] || C.fold(x.n).localeCompare(C.fold(y.n)); });
    a.links = links;
    a.mem = members.sort(function (x, y) { return (x.past || 0) - (y.past || 0) || (x.b || 9999) - (y.b || 9999); });
    a.grp = groups;
    if (QID_RE.test(wd)) a.wd = wd;
    return a;
  }

  // ---------- 4. MusicBrainz: discography + track lists ----------
  function groupsUrl(id, offset) {
    return mbId(id) ? MB + "release-group?" + qs({ artist: id, limit: 100, offset: offset || 0, fmt: "json" }) : "";
  }
  function caa(id, size) { return mbId(id) ? "https://coverartarchive.org/release-group/" + id + "/front-" + (size || 250) : ""; }
  var SEC = { live: "live", compilation: "comp", soundtrack: "other", remix: "other", demo: "other", interview: "other", spokenword: "other", audiobook: "other", "dj-mix": "other", "mixtape/street": "other" };
  function shelfOf(g) {
    var sec = (g.sec || []).map(function (s) { return String(s).toLowerCase(); });
    for (var i = 0; i < sec.length; i++) if (SEC[sec[i]]) return SEC[sec[i]];
    var ty = String(g.ty || "").toLowerCase();
    return ty === "album" ? "album" : ty === "single" || ty === "ep" ? "single" : "other";
  }
  function parseGroups(j) {
    var list = j && Array.isArray(j["release-groups"]) ? j["release-groups"] : [];
    var out = list.map(function (x) {
      var id = mbId(x && x.id);
      if (!id) return null;
      var g = { id: id, n: str(x.title) || "?", ty: str(x["primary-type"], 20), y: year(x["first-release-date"]) };
      var sec = Array.isArray(x["secondary-types"]) ? x["secondary-types"].map(function (s) { return str(s, 20); }).filter(Boolean) : [];
      if (sec.length) g.sec = sec;
      g.sh = shelfOf(g);
      return g;
    }).filter(Boolean);
    return { list: out, total: +(j && j["release-group-count"]) || out.length };
  }
  // Shelves in the order the page shows them, newest first.
  function shelves(list) {
    var by = { album: [], single: [], live: [], comp: [], other: [] };
    (list || []).forEach(function (g) { (by[g.sh] || by.other).push(g); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (x, y) { return (y.y || 0) - (x.y || 0) || C.fold(x.n).localeCompare(C.fold(y.n)); }); });
    return ["album", "single", "live", "comp", "other"].map(function (k) { return { k: k, list: by[k] }; }).filter(function (s) { return s.list.length; });
  }
  function releasesUrl(rgId) {
    return mbId(rgId) ? MB + "release?" + qs({ "release-group": rgId, inc: "recordings+artist-credits+media", status: "official", limit: 25, fmt: "json" }) : "";
  }
  function credit(ac) {
    if (!Array.isArray(ac)) return "";
    return str(ac.map(function (c) { return (c && (c.name || c.artist && c.artist.name) || "") + (c && c.joinphrase || ""); }).join(""));
  }
  function trackCount(rel) { return (rel.media || []).reduce(function (n, m) { return n + (Array.isArray(m && m.tracks) ? m.tracks.length : 0); }, 0); }
  // One release of the group: the earliest official one with tracks
  // (ties: the one with fewer tracks, so a deluxe box loses to the
  // album itself).
  function pickRelease(list) {
    var ok = (list || []).filter(function (r) { return r && mbId(r.id) && trackCount(r) > 0; });
    ok.sort(function (x, y) {
      var dx = String(x.date || "9999"), dy = String(y.date || "9999");
      return dx < dy ? -1 : dx > dy ? 1 : trackCount(x) - trackCount(y);
    });
    return ok[0] || null;
  }
  function parseRelease(j, rgId) {
    var rel = pickRelease(j && j.releases);
    if (!rel) return null;
    var who = credit(rel["artist-credit"]);
    var multi = (rel.media || []).length > 1, tracks = [];
    (rel.media || []).forEach(function (m, di) {
      (Array.isArray(m && m.tracks) ? m.tracks : []).forEach(function (x, i) {
        var rec = x && x.recording || {};
        var rid = mbId(rec.id) || mbId(x && x.id);
        if (!rid || tracks.length >= 400) return;
        var t = { k: "mb:" + C.hash(rid), t: str(x.title || rec.title) || "?", a: credit(x["artist-credit"] || rec["artist-credit"]) || who, n: +x.position || i + 1, rid: rid };
        var ms = +(x.length || rec.length) || 0;
        if (ms > 0) t.d = Math.round(ms / 1000);
        if (multi) t.dn = di + 1;
        tracks.push(t);
      });
    });
    return { id: mbId(rgId) || "", rel: rel.id, n: str(rel.title) || "?", a: who, y: year(rel.date), cc: /^[A-Z]{2}$/.test(rel.country || "") ? rel.country : "", tracks: tracks };
  }

  // ---------- 5. Wikidata + Wikipedia ----------
  function wdUrl(q) {
    return QID_RE.test(q || "") ? "https://www.wikidata.org/w/api.php?" + qs({ action: "wbgetentities", ids: q, props: "sitelinks", sitefilter: WIKI_LANGS.map(function (l) { return l + "wiki"; }).join("|"), format: "json", origin: "*" }) : "";
  }
  function parseSitelinks(j, q) {
    var e = j && j.entities && j.entities[q], sl = e && e.sitelinks || {}, out = {};
    WIKI_LANGS.forEach(function (l) { var x = sl[l + "wiki"]; if (x && typeof x.title === "string" && x.title.length <= 250) out[l] = x.title; });
    return out;
  }
  // [language, title]: the app language, then English, Greek, German.
  function wikiPick(titles, lang) {
    var l = String(lang || "").slice(0, 2), order = [l, "en", "el", "de"];
    for (var i = 0; i < order.length; i++) if (titles && titles[order[i]]) return [order[i], titles[order[i]]];
    return null;
  }
  function summaryUrl(lang, title) {
    if (WIKI_LANGS.indexOf(lang) < 0 || !title) return "";
    return "https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(String(title).replace(/ /g, "_"));
  }
  function imgOk(u) { return /^https:\/\/upload\.wikimedia\.org\/[^\s"'<>]{1,600}$/.test(u || "") ? u : ""; }
  function parseSummary(j, lang) {
    if (!j || j.type === "disambiguation" || typeof j.extract !== "string") return null;
    var x = j.extract.replace(/\s+/g, " ").trim();
    if (!x) return null;
    if (x.length > 1500) x = x.slice(0, 1500).replace(/\s+\S*$/, "") + "…";
    var pg = httpsUrl(j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page);
    if (!/^https:\/\/[a-z]{2}\.wikipedia\.org\//.test(pg)) pg = "";
    return { x: x, l: lang, pg: pg, im: imgOk(j.thumbnail && j.thumbnail.source) };
  }
  function p18Url(q) { return QID_RE.test(q || "") ? "https://www.wikidata.org/w/api.php?" + qs({ action: "wbgetclaims", entity: q, property: "P18", format: "json", origin: "*" }) : ""; }
  function parseP18(j) {
    var c = j && j.claims && Array.isArray(j.claims.P18) ? j.claims.P18[0] : null;
    var f = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (typeof f !== "string" || !f || f.length > 240 || /[\/\\<>"]/.test(f)) return "";
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f.replace(/ /g, "_")) + "?width=500";
  }

  // ---------- 6. Matching: which songs really play ----------
  // pool = songs Music can play (local, servers, open catalogues).
  // Each MusicBrainz track becomes the matching song (same artist,
  // same title once editions are stripped), else stays a track that
  // does not play here.
  function matchTracks(mbTracks, pool) {
    var byT = {};
    (pool || []).forEach(function (r) {
      if (!r || !r.t) return;
      var k = titleKey(r.t);
      (byT[k] = byT[k] || []).push(r);
    });
    return (mbTracks || []).map(function (x) {
      var cands = byT[titleKey(x.t)] || [];
      var hit = cands.filter(function (r) { return sameArtist(r.a, x.a); })[0];
      if (!hit) return Object.assign({ _mb: 1 }, x);
      var o = Object.assign({}, hit, { n: x.n });
      if (x.dn) o.dn = x.dn;
      return o;
    });
  }
  // Songs of a list that are by this artist (open catalogues match
  // names loosely; only the same artist may appear on its page).
  function byArtist(list, names) {
    var ns = (names || []).filter(Boolean);
    return (list || []).filter(function (r) { return r && ns.some(function (n) { return sameArtist(r.a, n); }); });
  }

  // ---------- 6b. ListenBrainz (wave 6c): world charts, fresh releases, similar artists ----------
  // Open data of the MetaBrainz Foundation, no key for these.
  var LB = "https://api.listenbrainz.org/1/";
  var RANGES = ["week", "month", "year"];
  function topArtistsUrl(range) { return LB + "stats/sitewide/artists?" + qs({ range: RANGES.indexOf(range) >= 0 ? range : "week", count: 30 }); }
  function firstMbid(x) {
    if (!x) return "";
    if (mbId(x.artist_mbid)) return x.artist_mbid;
    var l = Array.isArray(x.artist_mbids) ? x.artist_mbids : [];
    return mbId(l[0]) || "";
  }
  function parseTopArtists(j) {
    var list = j && j.payload && Array.isArray(j.payload.artists) ? j.payload.artists : [];
    var seen = {};
    return list.map(function (x) {
      var id = firstMbid(x);
      if (!id || seen[id]) return null;
      seen[id] = 1;
      return { id: id, n: str(x.artist_name) || "?", c: +x.listen_count || 0 };
    }).filter(Boolean);
  }
  function freshUrl(days) { return LB + "explore/fresh-releases/?" + qs({ days: Math.max(1, Math.min(30, days || 14)), sort: "release_date", past: "true", future: "false" }); }
  function caaRelease(id) { return mbId(id) ? "https://coverartarchive.org/release/" + id + "/front-250" : ""; }
  function parseFresh(j) {
    var list = j && j.payload && Array.isArray(j.payload.releases) ? j.payload.releases : [];
    var seen = {};
    var out = list.map(function (x) {
      var id = mbId(x && x.release_group_mbid);
      if (!id || seen[id]) return null;
      seen[id] = 1;
      var d = /^\d{4}-\d{2}-\d{2}$/.test(x.release_date || "") ? x.release_date : "";
      var o = { id: id, n: str(x.release_name) || "?", a: str(x.artist_credit_name) || "", ai: firstMbid(x), d: d, y: year(d),
        ty: str(x.release_group_primary_type, 20), art: caaRelease(x.caa_release_mbid) };
      if (Array.isArray(x.artist_mbids)) o.all = x.artist_mbids.filter(mbId).slice(0, 10);
      return o;
    }).filter(Boolean);
    out.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
    return out;
  }
  var SIM_ALGO = "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";
  function similarUrl(id) { return mbId(id) ? "https://labs.api.listenbrainz.org/similar-artists/json?" + qs({ artist_mbids: id, algorithm: SIM_ALGO }) : ""; }
  // The labs API answers either a list of artists or a list of
  // { type, data: [artists] } blocks; both are read.
  function parseSimilar(j, self) {
    var list = [];
    if (Array.isArray(j)) j.forEach(function (x) { if (x && Array.isArray(x.data)) list = list.concat(x.data); else list.push(x); });
    var seen = {};
    if (self) seen[self] = 1;
    return list.map(function (x) {
      var id = mbId(x && x.artist_mbid);
      if (!id || seen[id] || !x.name) return null;
      seen[id] = 1;
      return { id: id, n: str(x.name), sc: +x.score || 0 };
    }).filter(Boolean).sort(function (a, b) { return b.sc - a.sc; }).slice(0, 24);
  }

  // ---------- 7. Network (browser) ----------
  // JSON through open.js (straight from the browser, the relay "web"
  // op when a site sends no CORS headers), MusicBrainz one at a time.
  function O() { return root.OrosMusicOpen; }
  function Err(code) { var O0 = O(); return O0 ? new O0.OpenError(code) : { code: code }; }
  var mbChain = Promise.resolve(), mbLast = 0;
  function mbGet(url) {
    var run = function () {
      var wait = Math.max(0, mbLast + MB_GAP - Date.now());
      return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
        mbLast = Date.now();
        return O().getJSON(url, { timeout: 20000 });
      });
    };
    var p = mbChain.then(run, run);
    mbChain = p.catch(function () {});
    return p;
  }
  // Device cache (IndexedDB "oros-music-meta", store "c": { k, at, v }).
  var DB = "oros-music-meta", dbp = null, mem = {};
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) { idb = null; }
      if (!idb) { rej(new Error("no-idb")); return; }
      var rq = idb.open(DB, 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains("c")) rq.result.createObjectStore("c", { keyPath: "k" }); };
      rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { try { d.close(); } catch (e) {} dbp = null; }; res(d); };
      rq.onerror = rq.onblocked = function () { dbp = null; rej(rq.error || new Error("idb")); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("c", mode), os = t.objectStore("c"), out = fn(os);
        t.oncomplete = function () { res(out && "result" in out ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("tx")); };
      });
    });
  }
  function cacheGet(k, ttl) {
    var m = mem[k];
    if (m && Date.now() - m.at < ttl) return Promise.resolve(m.v);
    return tx("readonly", function (os) { return os.get(k); }).then(function (x) {
      if (x && Date.now() - x.at < ttl && x.at <= Date.now()) { mem[k] = x; return x.v; }
      return undefined;
    }, function () { return undefined; });
  }
  var puts = 0;
  function cachePut(k, v) {
    var x = { k: k, at: Date.now(), v: v };
    mem[k] = x;
    var ks = Object.keys(mem);
    if (ks.length > 120) ks.sort(function (a, b) { return mem[a].at - mem[b].at; }).slice(0, ks.length - 120).forEach(function (y) { delete mem[y]; });
    tx("readwrite", function (os) { os.put(x); }).catch(function () {});
    if (++puts % 25 === 0) prune();
    return v;
  }
  // At most 400 answers on the device; the oldest go first.
  function prune() {
    tx("readonly", function (os) { return os.getAll(); }).then(function (all) {
      var old = Date.now() - 30 * DAY;
      var drop = (all || []).filter(function (x) { return x.at < old; });
      var keep = (all || []).filter(function (x) { return x.at >= old; }).sort(function (a, b) { return b.at - a.at; });
      drop = drop.concat(keep.slice(400));
      if (drop.length) tx("readwrite", function (os) { drop.forEach(function (x) { os.delete(x.k); }); }).catch(function () {});
    }).catch(function () {});
  }
  function cached(k, ttl, make) {
    return cacheGet(k, ttl).then(function (v) { return v !== undefined ? v : make().then(function (x) { return cachePut(k, x); }); });
  }

  // search(q) -> [artist card]
  function search(q, lang) {
    var u = searchUrl(q);
    if (!u) return Promise.resolve([]);
    return cached("s|" + lang + "|" + nameKey(q), TTL.s, function () { return mbGet(u).then(function (j) { return parseSearch(j, lang); }); });
  }
  // The text and picture of the artist's Wikipedia article.
  function wiki(qid, lang) {
    if (!QID_RE.test(qid || "")) return Promise.resolve(null);
    return cached("w|" + qid + "|" + String(lang || "").slice(0, 2), TTL.w, function () {
      return O().getJSON(wdUrl(qid)).then(function (j) {
        var pick = wikiPick(parseSitelinks(j, qid), lang);
        if (!pick) return null;
        return O().getJSON(summaryUrl(pick[0], pick[1])).then(function (s) { return parseSummary(s, pick[0]); }, function () { return null; });
      }).then(function (w) {
        if (w && w.im) return w;
        return O().getJSON(p18Url(qid)).then(function (j) {
          var im = parseP18(j);
          if (!im) return w;
          return Object.assign({}, w || {}, { im: im });
        }, function () { return w; });
      });
    });
  }
  // artist(id) -> { a: artist, w: Wikipedia summary | null }
  function artist(id, lang) {
    if (!mbId(id)) return Promise.reject(Err("id"));
    return cached("a|" + id + "|" + String(lang || "").slice(0, 2), TTL.a, function () {
      return mbGet(artistUrl(id)).then(function (j) {
        var a = parseArtist(j, lang);
        if (!a) throw Err("json");
        return wiki(a.wd, lang).catch(function () { return null; }).then(function (w) { return { a: a, w: w || null }; });
      });
    });
  }
  // The discography (up to 300 release groups, three pages).
  function groups(id) {
    if (!mbId(id)) return Promise.reject(Err("id"));
    return cached("g|" + id, TTL.g, function () {
      var all = [];
      var page = function (off) {
        return mbGet(groupsUrl(id, off)).then(function (j) {
          var r = parseGroups(j);
          all = all.concat(r.list);
          if (r.list.length === 100 && all.length < r.total && all.length < 300) return page(all.length);
          return all;
        });
      };
      return page(0);
    });
  }
  // One album: the release MusicBrainz lists first for the group.
  function album(rgId) {
    if (!mbId(rgId)) return Promise.reject(Err("id"));
    return cached("r|" + rgId, TTL.r, function () {
      return mbGet(releasesUrl(rgId)).then(function (j) { var r = parseRelease(j, rgId); if (!r) throw Err("closed"); return r; });
    });
  }
  function pages(id) { return { mb: "https://musicbrainz.org/artist/" + id }; }
  // ListenBrainz (one day / a week on the device).
  function topArtists(range) {
    return cached("lt|" + range, DAY, function () { return O().getJSON(topArtistsUrl(range)).then(parseTopArtists); });
  }
  function fresh(days) {
    return cached("lf|" + days, DAY, function () { return O().getJSON(freshUrl(days)).then(parseFresh); });
  }
  function similar(id) {
    if (!mbId(id)) return Promise.reject(Err("id"));
    return cached("ls|" + id, 7 * DAY, function () { return O().getJSON(similarUrl(id)).then(function (j) { return parseSimilar(j, id); }); });
  }

  var api = {
    VERSION: "1.0.0", MB_GAP: MB_GAP, TTL: TTL, MBID_RE: MBID_RE, DB: DB,
    mbId: mbId, nameKey: nameKey, titleKey: titleKey, sameArtist: sameArtist, luceneWords: luceneWords,
    searchUrl: searchUrl, parseSearch: parseSearch, artistUrl: artistUrl, parseArtist: parseArtist, linkOf: linkOf,
    groupsUrl: groupsUrl, parseGroups: parseGroups, shelves: shelves, caa: caa, releasesUrl: releasesUrl, pickRelease: pickRelease, parseRelease: parseRelease,
    wdUrl: wdUrl, parseSitelinks: parseSitelinks, wikiPick: wikiPick, summaryUrl: summaryUrl, parseSummary: parseSummary, p18Url: p18Url, parseP18: parseP18,
    matchTracks: matchTracks, byArtist: byArtist,
    topArtistsUrl: topArtistsUrl, parseTopArtists: parseTopArtists, freshUrl: freshUrl, parseFresh: parseFresh, similarUrl: similarUrl, parseSimilar: parseSimilar,
    topArtists: topArtists, fresh: fresh, similar: similar,
    search: search, artist: artist, groups: groups, album: album, wiki: wiki, pages: pages
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMusicArtists = api;
})(typeof window !== "undefined" ? window : globalThis);
