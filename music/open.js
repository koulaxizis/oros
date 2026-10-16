// ============================================================
// orOS Music — open.js (open catalogues, v1.0.0)
// Free and legal music from three open catalogues, read straight
// from the browser when the user browses or searches (never in the
// background):
//   ia  Internet Archive  advancedsearch + metadata APIs, no key.
//       Only items with a Creative Commons / public-domain licence,
//       plus the Live Music Archive (collection "etree": bands that
//       allow free, non-commercial sharing of their live tapes).
//       The 78rpm / Great 78 collections are left out.
//   ov  Openverse         audio API (category music), no key; CC/PD
//       only by design. Tracks it lists from Jamendo stream only
//       (Jamendo's terms forbid offline copies).
//   cc  ccMixter          query API, no key; every upload is CC.
//   jm  Jamendo           API v3.0 with orOS's one public client id
//       (since wave 3): tracks, albums, artists, radios. Streaming
//       only (Jamendo's terms forbid offline copies); every song links
//       back to its Jamendo page and credits Jamendo.
// Audio always streams straight from the source (never through the
// relay); JSON goes direct, the Mail relay's "web" op is only the
// fallback when a site sends no CORS headers (../feeds/fetch.js).
//
// A track from here ("remote ref") is the same shape the rest of
// Music uses, plus: s (source), u (https audio), pg (https page),
// art (https cover), li (licence), vi (Openverse's own source),
// off (1 = the licence and source allow an offline copy).
// Pure parts (URLs, parsers, licences, credits) run in Node too;
// tests/music.test.js covers them with copied API answers.
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosMusicCore || (typeof require === "function" ? require("./core.js").OrosMusicCore : null);
  var PAGE = { ia: 24, ov: 20, cc: 20, jm: 20 };
  // Registered by Chris at devportal.jamendo.com (2026-10-16); public,
  // one for every orOS user, non-commercial use.
  var JM_CLIENT = "e04c6e83";
  var CACHE_MS = 30 * 60 * 1000, CACHE_MAX = 80;

  var SOURCES = {
    ia: { name: "Internet Archive", home: "https://archive.org/details/audio" },
    ov: { name: "Openverse", home: "https://openverse.org/audio" },
    cc: { name: "ccMixter", home: "https://ccmixter.org/" },
    jm: { name: "Jamendo", home: "https://www.jamendo.com/" }
  };
  // Openverse's own sources, for the credit line.
  var OV_VIA = { jamendo: "Jamendo", freesound: "Freesound", wikimedia_audio: "Wikimedia Commons", ccmixter: "ccMixter" };

  // ---------- 1. Licences ----------
  // li: "cc0" | "pdm" | "lma" | "by[-nc][-sa|-nd]" | "[nc-]sampling+", plus " <version>".
  var LI_RE = /^(cc0|pdm|lma|by(-nc)?(-sa|-nd)?|(nc-)?sampling\+)( \d\.\d)?$/;
  function licFromUrl(url) {
    var s = String(url || "").toLowerCase();
    if (!/creativecommons\.org\//.test(s)) return "";
    if (/\/publicdomain\/zero\//.test(s)) return "cc0";
    if (/\/publicdomain\/(mark|certification)\//.test(s) || /\/licenses\/publicdomain/.test(s)) return "pdm";
    var m = /\/licenses\/([a-z+-]+)\/(\d\.\d)/.exec(s) || /\/licenses\/([a-z+-]+)\/?/.exec(s);
    if (!m) return "";
    var code = m[1].replace(/-+$/, "");
    var li = code + (m[2] ? " " + m[2] : "");
    return LI_RE.test(li) ? li : "";
  }
  function licFromCode(code, ver) {
    var c = String(code || "").toLowerCase().trim();
    var v = /^\d\.\d$/.test(String(ver || "")) ? " " + ver : "";
    if (c === "cc0" || c === "pdm") return c;
    var li = c + v;
    return LI_RE.test(li) ? li : "";
  }
  function licParts(li) { var m = /^(\S+)(?: (\d\.\d))?$/.exec(String(li || "")); return m ? { c: m[1], v: m[2] || "" } : { c: "", v: "" }; }
  function licLabel(li, lang) {
    var p = licParts(li), el = lang === "el";
    if (p.c === "cc0") return "CC0";
    if (p.c === "pdm") return el ? "Κοινό κτήμα" : "Public domain";
    if (p.c === "lma") return el ? "Live Music Archive (ελεύθερη μη εμπορική διανομή)" : "Live Music Archive (free non-commercial sharing)";
    if (!p.c) return el ? "Άγνωστη άδεια" : "Unknown licence";
    return "CC " + p.c.toUpperCase() + (p.v ? " " + p.v : "");
  }
  function licShort(li) {
    var p = licParts(li);
    if (p.c === "cc0") return "CC0";
    if (p.c === "pdm") return "PD";
    if (p.c === "lma") return "LMA";
    return p.c ? "CC " + p.c.toUpperCase() : "";
  }
  function licUrl(li) {
    var p = licParts(li);
    if (p.c === "cc0") return "https://creativecommons.org/publicdomain/zero/1.0/";
    if (p.c === "pdm") return "https://creativecommons.org/publicdomain/mark/1.0/";
    if (p.c === "lma") return "https://archive.org/details/etree";
    if (!p.c) return "";
    return "https://creativecommons.org/licenses/" + p.c + "/" + (p.v || (/sampling/.test(p.c) ? "1.0" : "4.0")) + "/";
  }

  // ---------- 2. Small helpers ----------
  function str(v) {
    if (Array.isArray(v)) v = v[0];
    return C.clean(typeof v === "number" ? String(v) : v);
  }
  function https(u) {
    var s = typeof u === "string" ? u.trim() : "";
    if (/^http:\/\/([a-z0-9-]+\.)*(ccmixter\.org|archive\.org|openverse\.org|jamendo\.com|freesound\.org|wikimedia\.org)(\/|$)/i.test(s)) s = "https://" + s.slice(7);
    return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000 ? s : "";
  }
  // "245.3" | "4:05" | "1:02:03" -> seconds
  function secs(v) {
    if (typeof v === "number") return v > 0 && v < 360000 ? Math.round(v) : 0;
    var s = String(v || "").trim();
    if (/^\d+(\.\d+)?$/.test(s)) return secs(+s);
    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) { var n = 0; s.split(":").forEach(function (x) { n = n * 60 + (+x); }); return secs(n); }
    return 0;
  }
  function qs(p) {
    return Object.keys(p).filter(function (k) { return p[k] !== "" && p[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k]); }).join("&");
  }
  // Words of a free-text query, safe inside an archive.org Lucene query.
  function iaWords(q) {
    return String(q || "").replace(/[\\+\-!(){}[\]^"~*?:/&|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  function key(prefix, id) { return prefix + ":" + C.hash(String(id)); }
  function ref(o) {
    var r = C.normRef(o);
    return r && r.s ? r : null;
  }

  // ---------- 3. Internet Archive ----------
  // Music only, open licences only, no 78rpm (legal dispute) and no
  // spoken word / radio collections.
  var IA_BASE = "mediatype:(audio OR etree) AND -collection:(78rpm OR georgeblood OR librivoxaudio OR audio_bookspoetry OR oldtimeradio OR podcasts OR radioprograms)" +
    " AND (collection:(etree) OR licenseurl:(*creativecommons.org*))";
  var IA_FL = ["identifier", "title", "creator", "date", "year", "licenseurl", "collection", "downloads"];
  function iaSearchUrl(o) {
    o = o || {};
    var parts = [];
    var w = iaWords(o.q);
    if (w) parts.push("(" + w + ")");
    if (o.creator) parts.push('creator:("' + iaWords(o.creator) + '")');
    if (o.subject) parts.push("subject:(" + iaWords(o.subject) + ")");
    if (o.coll) parts.push("collection:(" + iaWords(o.coll) + ")");
    parts.push(IA_BASE);
    var p = "q=" + encodeURIComponent(parts.join(" AND "));
    IA_FL.forEach(function (f) { p += "&fl%5B%5D=" + f; });
    p += "&sort%5B%5D=" + encodeURIComponent(o.sort || "downloads desc");
    p += "&rows=" + PAGE.ia + "&page=" + Math.max(1, o.page || 1) + "&output=json";
    return "https://archive.org/advancedsearch.php?" + p;
  }
  function iaLicence(licenseurl, collections) {
    var li = licFromUrl(licenseurl);
    if (li) return li;
    var cs = Array.isArray(collections) ? collections : collections ? [collections] : [];
    return cs.indexOf("etree") >= 0 ? "lma" : "";
  }
  function iaId(id) { return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? id : ""; }
  function iaAlbumCard(d) {
    var id = iaId(d && d.identifier);
    if (!id) return null;
    var li = iaLicence(d.licenseurl, d.collection);
    if (!li) return null;
    return { s: "ia", id: id, n: str(d.title) || id, a: str(d.creator), y: str(d.year) || (str(d.date).match(/\d{4}/) || [""])[0],
      li: li, art: "https://archive.org/services/img/" + id, pg: "https://archive.org/details/" + id };
  }
  function iaParseSearch(j, page) {
    var r = j && j.response;
    var docs = r && Array.isArray(r.docs) ? r.docs : [];
    var albums = docs.map(iaAlbumCard).filter(Boolean);
    var total = r && +r.numFound || 0;
    return { albums: albums, more: (Math.max(1, page || 1)) * PAGE.ia < total };
  }
  function iaMetaUrl(id) { return "https://archive.org/metadata/" + encodeURIComponent(id); }
  // Formats a browser plays, best first.
  var IA_FMT = { "VBR MP3": 1, "320Kbps MP3": 2, "256Kbps MP3": 2, "192Kbps MP3": 2, "128Kbps MP3": 3, "MP3": 3, "64Kbps MP3": 4,
    "Ogg Vorbis": 5, "Opus": 5, "Flac": 6, "24bit Flac": 7, "WAVE": 8 };
  function iaPath(id, name) { return "https://archive.org/download/" + encodeURIComponent(id) + "/" + String(name).split("/").map(encodeURIComponent).join("/"); }
  function iaParseMeta(j, idIn) {
    var meta = j && j.metadata, id = iaId(idIn);
    if (!meta || !id || !Array.isArray(j.files)) return null;
    if (meta["access-restricted-item"] === "true" || meta["access-restricted-item"] === true) return null;
    var li = iaLicence(meta.licenseurl, meta.collection);
    if (!li) return null;
    var album = { s: "ia", id: id, n: str(meta.title) || id, a: str(meta.creator), y: (str(meta.date).match(/\d{4}/) || [""])[0] || str(meta.year),
      li: li, art: "https://archive.org/services/img/" + id, pg: "https://archive.org/details/" + id,
      off: meta.stream_only || meta["stream-only"] ? 0 : 1 };
    var byName = {};
    j.files.forEach(function (f) { if (f && typeof f.name === "string") byName[f.name] = f; });
    // Every playable file belongs to its root original (a FLAC, a SHN…);
    // one track per root, in its best playable format.
    var roots = {}, order = [];
    j.files.forEach(function (f) {
      if (!f || typeof f.name !== "string" || f.private === "true" || f.private === true) return;
      var rank = IA_FMT[f.format];
      if (!rank) return;
      var root0 = f, hops = 0;
      while (root0.source === "derivative" && root0.original && byName[root0.original] && hops++ < 4) root0 = byName[root0.original];
      var rk = root0.name;
      if (!roots[rk]) { roots[rk] = { root: root0, best: f, rank: rank }; order.push(rk); }
      else if (rank < roots[rk].rank) { roots[rk].best = f; roots[rk].rank = rank; }
    });
    var tracks = order.map(function (rk, i) {
      var x = roots[rk], f = x.best, r0 = x.root;
      var tn = parseInt(String(r0.track || f.track || "").split("/")[0], 10);
      var t = str(r0.title || f.title) || C.stem(String(rk).split("/").pop()) || rk;
      var o = { k: key("ia", id + "/" + rk), t: t, a: str(r0.creator || f.creator || r0.artist || f.artist) || album.a,
        al: album.n, d: secs(f.length || r0.length), s: "ia", u: iaPath(id, f.name), pg: album.pg, art: album.art, li: li };
      if (album.off) o.off = 1;
      var r = ref(o);
      if (r) { r._n = isFinite(tn) && tn > 0 ? tn : 0; r._i = i; }
      return r;
    }).filter(Boolean);
    // Track numbers first (when the item has them), else file order.
    var numbered = tracks.some(function (r) { return r._n; });
    tracks.sort(function (a, b) {
      if (numbered && a._n !== b._n) return (a._n || 1e9) - (b._n || 1e9);
      return numbered ? String(a.u).localeCompare(String(b.u), undefined, { numeric: true }) : a._i - b._i;
    });
    tracks.forEach(function (r, i) { r.n = r._n || i + 1; delete r._n; delete r._i; });
    return { album: album, tracks: tracks };
  }
  // The item id of an Internet Archive page link.
  function iaIdFromPage(pg) { var m = /^https:\/\/archive\.org\/details\/([^/?#]+)/.exec(String(pg || "")); return m ? iaId(decodeURIComponent(m[1])) : ""; }

  // ---------- 4. Openverse ----------
  function ovUrl(o) {
    o = o || {};
    var p = { page_size: PAGE.ov, page: Math.max(1, o.page || 1), category: "music", mature: "false" };
    if (o.creator) p.creator = String(o.creator).slice(0, 120);
    else if (o.q) p.q = String(o.q).slice(0, 200);
    if (o.tags) p.tags = String(o.tags).slice(0, 120);
    return "https://api.openverse.org/v1/audio/?" + qs(p);
  }
  function ovTrack(x) {
    if (!x || typeof x.id !== "string") return null;
    var li = licFromCode(x.license, x.license_version);
    var u = https(x.url);
    if (!li || !u) return null;
    var via = typeof x.source === "string" && /^[a-z_]{1,30}$/.test(x.source) ? x.source : "";
    var o = { k: key("ov", x.id), t: str(x.title) || "?", a: str(x.creator), d: secs((+x.duration || 0) / 1000),
      s: "ov", u: u, pg: https(x.foreign_landing_url), art: https(x.thumbnail), li: li };
    var set = x.audio_set && typeof x.audio_set === "object" ? str(x.audio_set.title) : "";
    if (set) o.al = set;
    if (via) o.vi = via;
    if (via !== "jamendo") o.off = 1;
    return ref(o);
  }
  function ovParse(j, page) {
    var res = j && Array.isArray(j.results) ? j.results : [];
    var pages = j && +j.page_count || 0;
    return { tracks: res.map(ovTrack).filter(Boolean), more: Math.max(1, page || 1) < pages };
  }

  // ---------- 5. ccMixter ----------
  function ccUrl(o) {
    o = o || {};
    var p = { f: "json", limit: PAGE.cc, offset: (Math.max(1, o.page || 1) - 1) * PAGE.cc, sort: o.sort || "rank", ord: "desc" };
    if (o.q) { p.search = String(o.q).slice(0, 120); p.search_type = "all"; }
    if (o.tags) p.tags = String(o.tags).replace(/[^a-z0-9_,]/gi, "").slice(0, 120);
    if (o.user) p.user = String(o.user).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
    return "https://ccmixter.org/api/query?" + qs(p);
  }
  function ccTrack(x) {
    if (!x || typeof x !== "object" || x.upload_id == null) return null;
    var li = licFromUrl(x.license_url);
    if (!li) return null;
    var files = Array.isArray(x.files) ? x.files : [];
    var f = files.filter(function (y) {
      var info = y && y.file_format_info || {};
      return /audio\/(mpeg|mp3|ogg)/i.test(info["mime_type"] || "") || /\.(mp3|ogg)$/i.test(y && y.file_name || "");
    })[0];
    var u = f && https(f.download_url);
    if (!u) return null;
    var info = f.file_format_info || {};
    return ref({ k: key("cc", x.upload_id), t: str(x.upload_name) || "?", a: str(x.user_real_name) || str(x.user_name), d: secs(info.ps),
      s: "cc", u: u, pg: https(x.file_page_url), li: li, off: 1 });
  }
  function ccParse(j) {
    var list = Array.isArray(j) ? j : [];
    return { tracks: list.map(ccTrack).filter(Boolean), more: list.length >= PAGE.cc };
  }
  // The ccMixter user of a page link ("…/files/<user>/<id>").
  function ccUserFromPage(pg) { var m = /^https:\/\/ccmixter\.org\/files\/([A-Za-z0-9_.-]+)\//.exec(String(pg || "")); return m ? m[1] : ""; }

  // ---------- 5b. Jamendo ----------
  function jmUrl(path, p) {
    var o = { client_id: JM_CLIENT, format: "json" };
    Object.keys(p || {}).forEach(function (k) { o[k] = p[k]; });
    return "https://api.jamendo.com/v3.0/" + path + "/?" + qs(o);
  }
  function jmId(v) { var s = v == null ? "" : String(v); return /^[0-9]{1,12}$/.test(s) ? s : ""; }
  function jmWord(v, n) { return String(v || "").replace(/[^\p{L}\p{N} _+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n || 80); }
  // o: { q, tags, mood, artist, order, page }
  function jmTracksUrl(o) {
    o = o || {};
    var p = { limit: PAGE.jm, offset: (Math.max(1, o.page || 1) - 1) * PAGE.jm, audioformat: "mp32", imagesize: 300 };
    if (o.q) p.search = jmWord(o.q, 120);
    if (o.tags) p.tags = jmWord(o.tags);
    if (o.mood) p.fuzzytags = jmWord(o.mood);
    if (jmId(o.artist)) p.artist_id = jmId(o.artist);
    if (o.order) p.order = String(o.order).replace(/[^a-z_]/g, "");
    else if (!o.q) p.order = "popularity_total";
    return jmUrl("tracks", p);
  }
  function jmAlbumsUrl(o) {
    o = o || {};
    var p = { limit: PAGE.jm, offset: (Math.max(1, o.page || 1) - 1) * PAGE.jm, imagesize: 300, order: String(o.order || "popularity_total").replace(/[^a-z_]/g, "") };
    if (o.q) p.namesearch = jmWord(o.q, 120);
    if (jmId(o.artist)) p.artist_id = jmId(o.artist);
    return jmUrl("albums", p);
  }
  function jmAlbumTracksUrl(id) { return jmUrl("albums/tracks", { id: jmId(id), audioformat: "mp32", imagesize: 300 }); }
  function jmRadiosUrl() { return jmUrl("radios", { limit: 50, imagesize: 300 }); }
  function jmRadioStreamUrl(id) { return jmUrl("radios/stream", { id: jmId(id) }); }
  function jmResults(j) {
    var h = j && j.headers;
    if (!h || h.status !== "success" || !Array.isArray(j.results)) throw new OpenError(h && (h.code === 5 || h.code === 429) ? "busy" : "http");
    return j.results;
  }
  // One song; p = the album it was listed under (albums/tracks).
  function jmTrack(x, p) {
    p = p || {};
    var id = jmId(x && x.id), u = https(x && x.audio);
    if (!id || !u) return null;
    var o = { k: key("jm", id), t: str(x.name) || "?", a: str(x.artist_name || p.artist_name), d: secs(+x.duration || 0),
      s: "jm", u: u, pg: https(x.shareurl) || "https://www.jamendo.com/track/" + id, art: https(x.album_image || x.image || p.image) };
    var al = str(x.album_name || p.name);
    if (al) o.al = al;
    var li = licFromUrl(x.license_ccurl);
    if (li) o.li = li;
    var ai = jmId(x.album_id || p.id), ri = jmId(x.artist_id || p.artist_id);
    if (ai) o.ai = ai;
    if (ri) o.ri = ri;
    var r = ref(o);
    if (r && +x.position > 0) r.n = +x.position;
    return r;
  }
  function jmParseTracks(j) {
    var list = jmResults(j);
    return { tracks: list.map(function (x) { return jmTrack(x); }).filter(Boolean), more: list.length >= PAGE.jm };
  }
  function jmAlbumCard(x) {
    var id = jmId(x && x.id);
    if (!id) return null;
    return { s: "jm", id: id, n: str(x.name) || id, a: str(x.artist_name), y: (str(x.releasedate).match(/\d{4}/) || [""])[0],
      art: https(x.image), pg: https(x.shareurl) || "https://www.jamendo.com/album/" + id, ri: jmId(x.artist_id) };
  }
  function jmParseAlbums(j) {
    var list = jmResults(j);
    return { albums: list.map(jmAlbumCard).filter(Boolean), more: list.length >= PAGE.jm };
  }
  function jmParseAlbum(j) {
    var a = jmResults(j)[0];
    if (!a) throw new OpenError("http");
    var album = jmAlbumCard(a);
    var tracks = (Array.isArray(a.tracks) ? a.tracks : []).map(function (x) { return jmTrack(x, a); }).filter(Boolean);
    tracks.sort(function (x, y) { return (x.n || 1e9) - (y.n || 1e9); });
    tracks.forEach(function (r, i) { if (!r.n) r.n = i + 1; });
    return { album: album, tracks: tracks };
  }
  function jmParseRadios(j) {
    return { radios: jmResults(j).map(function (x) {
      var id = jmId(x && x.id);
      return id ? { s: "jm", id: id, n: str(x.dispname || x.name) || id, art: https(x.image) } : null;
    }).filter(Boolean), more: false };
  }
  // A radio as one endless "song".
  function jmRadioItem(j, radio) {
    var x = jmResults(j)[0], u = x && https(x.stream);
    if (!u) throw new OpenError("http");
    return ref({ k: key("jm", "radio/" + radio.id), t: str(x.dispname) || radio.n, a: "Jamendo Radio", s: "jm", u: u,
      pg: "https://www.jamendo.com/radios", art: radio.art || "" });
  }

  // ---------- 6. Browse shelves (Home) ----------
  var BROWSE = [
    { id: "live", src: "ia", en: "Live concerts", el: "Συναυλίες live", ia: { coll: "etree" } },
    { id: "netlabels", src: "ia", en: "Netlabel albums", el: "Άλμπουμ από netlabels", ia: { coll: "netlabels" } },
    { id: "new", src: "ia", en: "New free albums", el: "Νέα ελεύθερα άλμπουμ", ia: { coll: "netlabels", sort: "publicdate desc" } },
    { id: "classical", src: "ia", en: "Classical", el: "Κλασική", ia: { subject: "classical" } },
    { id: "remix", src: "cc", en: "Remixes", el: "Remix", cc: { tags: "remix" } },
    { id: "instr", src: "cc", en: "Instrumentals", el: "Ορχηστρικά", cc: { tags: "instrumental" } },
    { id: "free", src: "ov", en: "Free songs (Openverse)", el: "Ελεύθερα τραγούδια (Openverse)", ov: {} },
    { id: "jmweek", src: "jm", en: "Popular this week", el: "Δημοφιλή της εβδομάδας", jm: { order: "popularity_week" } },
    { id: "jmnew", src: "jm", en: "New albums", el: "Νέα άλμπουμ", jm: { albums: 1, order: "releasedate_desc" } },
    { id: "jmtop", src: "jm", en: "All-time favourites", el: "Τα αγαπημένα όλων των εποχών", jm: { order: "popularity_total" } },
    { id: "jmradio", src: "jm", en: "Jamendo radios", el: "Ραδιόφωνα Jamendo", jm: { radios: 1 } }
  ];
  // Moods (Jamendo's own tags).
  var MOODS = [
    ["relaxed", "Relaxed", "Χαλαρή"], ["happy", "Happy", "Χαρούμενη"], ["energetic", "Energetic", "Γεμάτη ενέργεια"],
    ["romantic", "Romantic", "Ρομαντική"], ["sad", "Melancholic", "Μελαγχολική"], ["epic", "Epic", "Επική"], ["dark", "Dark", "Σκοτεινή"]
  ];
  var OPEN_GENRES = [
    ["rock", "Rock", "Ροκ"], ["jazz", "Jazz", "Τζαζ"], ["electronic", "Electronic", "Ηλεκτρονική"], ["hiphop", "Hip-hop", "Χιπ χοπ"],
    ["folk", "Folk", "Φολκ"], ["ambient", "Ambient", "Ambient"], ["classical", "Classical", "Κλασική"], ["blues", "Blues", "Μπλουζ"],
    ["pop", "Pop", "Ποπ"], ["reggae", "Reggae", "Ρέγκε"], ["metal", "Metal", "Μέταλ"], ["world", "World", "Έθνικ"]
  ];
  function browseOf(id) { return BROWSE.filter(function (b) { return b.id === id; })[0] || null; }
  function moodOf(id) { var g = MOODS.filter(function (x) { return x[0] === id; })[0]; return g ? { id: g[0], en: g[1], el: g[2] } : null; }
  function genreOf(id) { var g = OPEN_GENRES.filter(function (x) { return x[0] === id; })[0]; return g ? { id: g[0], en: g[1], el: g[2] } : null; }

  // ---------- 7. Credit line ----------
  // EN: “Title” by Artist, CC BY 4.0 (licence link), from Internet Archive: page
  // EL: «Τίτλος», καλλιτέχνης: Artist, CC BY 4.0 (link), από Internet Archive: page
  function sourceName(r) {
    var n = SOURCES[r && r.s] ? SOURCES[r.s].name : "";
    if (r && r.s === "ov" && r.vi && OV_VIA[r.vi]) n += " (" + OV_VIA[r.vi] + ")";
    return n;
  }
  function credit(r, lang) {
    if (!r || !r.s) return "";
    var el = lang === "el";
    var line = el ? "«" + (r.t || "Χωρίς τίτλο") + "»" : "“" + (r.t || "Untitled") + "”";
    if (r.a) line += el ? ", καλλιτέχνης: " + r.a : " by " + r.a;
    if (r.li) line += ", " + licLabel(r.li, lang) + (licUrl(r.li) ? " (" + licUrl(r.li) + ")" : "");
    line += ", " + (el ? "από " : "from ") + sourceName(r);
    if (r.pg) line += ": " + r.pg;
    return line;
  }

  // ---------- 8. Network (browser) ----------
  var cache = {};
  function cacheGet(u) { var c = cache[u]; return c && Date.now() - c.at < CACHE_MS ? c.v : null; }
  function cachePut(u, v) {
    cache[u] = { at: Date.now(), v: v };
    var ks = Object.keys(cache);
    if (ks.length > CACHE_MAX) ks.sort(function (a, b) { return cache[a].at - cache[b].at; }).slice(0, ks.length - CACHE_MAX).forEach(function (k) { delete cache[k]; });
  }
  function OpenError(code) { this.code = code; }
  OpenError.prototype.toString = function () { return "OpenError: " + this.code; };
  // JSON from a public API: straight from the browser, the relay's
  // "web" op when the site sends no CORS headers.
  function getJSON(url, opts) {
    var hit = cacheGet(url);
    if (hit) return Promise.resolve(hit);
    var FF = root.orosFeedsFetch;
    var p;
    if (FF && typeof FF.fetchOne === "function") {
      p = FF.fetchOne(url, { accept: "application/json", timeout: (opts && opts.timeout) || 20000 }).then(function (r) {
        if (r.status === 429) throw new OpenError("busy");
        if (r.status >= 400 || !r.status) throw new OpenError("http");
        return r.text;
      }, function (e) { throw new OpenError((e && e.code) || "net"); });
    } else if (typeof root.fetch === "function") {
      p = root.fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) {
        if (r.status === 429) throw new OpenError("busy");
        if (!r.ok) throw new OpenError("http");
        return r.text();
      }, function () { throw new OpenError("net"); });
    } else return Promise.reject(new OpenError("net"));
    return p.then(function (text) {
      var j;
      try { j = JSON.parse(text); } catch (e) { throw new OpenError("json"); }
      cachePut(url, j);
      return j;
    });
  }
  // o: { q, page, ... }  -> Promise<{ albums? , tracks?, more }>
  function iaSearch(o) { o = o || {}; return getJSON(iaSearchUrl(o)).then(function (j) { return iaParseSearch(j, o.page); }); }
  function iaAlbum(id) {
    id = iaId(id);
    if (!id) return Promise.reject(new OpenError("id"));
    return getJSON(iaMetaUrl(id)).then(function (j) { var r = iaParseMeta(j, id); if (!r) throw new OpenError("closed"); return r; });
  }
  function ovSearch(o) { o = o || {}; return getJSON(ovUrl(o)).then(function (j) { return ovParse(j, o.page); }); }
  function ccSearch(o) { o = o || {}; return getJSON(ccUrl(o), { timeout: 25000 }).then(ccParse); }
  function jmTracks(o) { return getJSON(jmTracksUrl(o)).then(jmParseTracks); }
  function jmAlbums(o) { return getJSON(jmAlbumsUrl(o)).then(jmParseAlbums); }
  function jmAlbum(id) {
    if (!jmId(id)) return Promise.reject(new OpenError("id"));
    return getJSON(jmAlbumTracksUrl(id)).then(jmParseAlbum);
  }
  function jmRadios() { return getJSON(jmRadiosUrl()).then(jmParseRadios); }
  function jmRadio(radio) { return getJSON(jmRadioStreamUrl(radio.id)).then(function (j) { return jmRadioItem(j, radio); }); }

  var api = {
    VERSION: "1.1.0", SOURCES: SOURCES, OV_VIA: OV_VIA, PAGE: PAGE, BROWSE: BROWSE, OPEN_GENRES: OPEN_GENRES, MOODS: MOODS, LI_RE: LI_RE,
    JM_CLIENT: JM_CLIENT, jmTracksUrl: jmTracksUrl, jmAlbumsUrl: jmAlbumsUrl, jmAlbumTracksUrl: jmAlbumTracksUrl, jmRadiosUrl: jmRadiosUrl,
    jmRadioStreamUrl: jmRadioStreamUrl, jmParseTracks: jmParseTracks, jmParseAlbums: jmParseAlbums, jmParseAlbum: jmParseAlbum,
    jmParseRadios: jmParseRadios, jmRadioItem: jmRadioItem, moodOf: moodOf,
    jmTracks: jmTracks, jmAlbums: jmAlbums, jmAlbum: jmAlbum, jmRadios: jmRadios, jmRadio: jmRadio,
    licFromUrl: licFromUrl, licFromCode: licFromCode, licLabel: licLabel, licShort: licShort, licUrl: licUrl,
    secs: secs, https: https, iaWords: iaWords,
    iaSearchUrl: iaSearchUrl, iaParseSearch: iaParseSearch, iaMetaUrl: iaMetaUrl, iaParseMeta: iaParseMeta, iaIdFromPage: iaIdFromPage,
    ovUrl: ovUrl, ovParse: ovParse, ccUrl: ccUrl, ccParse: ccParse, ccUserFromPage: ccUserFromPage,
    browseOf: browseOf, genreOf: genreOf, sourceName: sourceName, credit: credit,
    getJSON: getJSON, iaSearch: iaSearch, iaAlbum: iaAlbum, ovSearch: ovSearch, ccSearch: ccSearch, OpenError: OpenError
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMusicOpen = api;
})(typeof window !== "undefined" ? window : globalThis);
