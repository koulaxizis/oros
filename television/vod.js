// ============================================================
// orOS Television — Films & shows, pure logic (TV-VOD wave 1)
// Free films, shorts, series and documentaries from two open
// catalogues, read straight from the browser when the user opens
// the Films & shows tab (never in the background):
//   wd  Wikimedia Commons, as catalogued by Wikidata (the catalogue
//       WikiFlix uses): every film whose full video is on Commons.
//       Commons keeps only freely licensed or public-domain files,
//       so every title here is free to watch. One catalogue of a few
//       thousand titles, read with four SPARQL queries (TSV) at most
//       once a week and filtered on the device.
//   ia  Internet Archive, its curated film collections only (never
//       the unsorted uploads). Rights (Chris D2, 2026-11-21):
//       "confirmed free" by default = published at least 96 years
//       ago (public domain in the US by age) or in the Prelinger
//       Archives (given to the public by their owner). A switch also
//       shows the rest, labelled "listed as public domain by the
//       Internet Archive, not checked by orOS": its licence marks are
//       set by uploaders and were found wrong on recent studio films.
// Video always streams from the source (never through the relay).
// No DOM, no network: window.orosTvVod in the app, module.exports
// in Node (tests/television-vod.test.js).
//
//   iaSearchUrl(o), iaParseSearch(j, o)   Internet Archive search
//   iaMetaUrl(id), iaParseMeta(j, id)     one item: parts to play
//   WD_QUERIES, wdQueryUrl(sparql), parseTsv(text)
//   wdBuild(tsv{main, facets, dirs, labels}) -> catalogue items
//   wdFilter(items, o) -> { items, total }
//   commonsInfoUrl(file), commonsPick(j, canPlay) -> { url, lic, ... }
//   normFilter(f), filterSupport(src, f)
//   item(o) -> the one item shape every list uses (see below)
//   normVod(obj), mergeVod(remote, local, into)  synced fields
//   resumeOf(obj, k), setResume(obj, it, pos, dur, now)
//   watchOn(obj, k), setWatch(obj, it, on, now)
//   continueList(obj), watchList(obj)
//
// Item: { k: "wd:Q…" | "ia:<id>", s: "wd" | "ia", t: title,
//   tl: { en, el, de } titles, y: year, d: minutes, ty: type,
//   g: [genre ids], c: [country codes], l: [language codes],
//   dir: director(s), im: https image, v: [commons files] (wd),
//   ser: series key, sl: popularity, ok: 1 confirmed free | 0,
//   why: "commons" | "age" | "prelinger" | "listed", snd, col }
// Every string that came from a catalogue is plain text here; the
// app escapes it (textContent) before it reaches the page.
// ============================================================
(function (root) {
  "use strict";

  var PAGE = 24;
  // Keys of every source: "wd:Q…", "ia:<id>", "na:<NASA id>", "eu:/<id>",
  // "oi:/<id>", "pt:<host>/<uuid>"; any later two-letter source too, so
  // a synced entry from a newer version is kept here (TV-VOD2).
  var KEY_RE = /^(wd:Q\d{1,12}|ia:[A-Za-z0-9][A-Za-z0-9._-]{0,99}|(?!wd:|ia:)[a-z]{2}:[A-Za-z0-9\/][A-Za-z0-9 _.,'()\/:-]{0,199})$/;
  var MAX_WD = 8000;           // catalogue items kept
  var MAX_WATCH = 400;         // synced watchlist entries (removed ones included)
  var MAX_RESUME = 200;        // synced resume positions
  var MAX_SAVED = 60;          // synced saved searches (removed ones included)
  var SS_KEY = /^[a-z0-9]{4,24}$/;
  var YEAR_MIN = 1880;

  // ---------- 1. Small helpers ----------
  function str(v) {
    if (Array.isArray(v)) v = v[0];
    if (typeof v === "number") return String(v);
    return typeof v === "string" ? v : "";
  }
  function clip(s, n) {
    s = str(s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function fold(s) {
    s = str(s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");   // i18n-inline-ok: final sigma folds for search
  }
  function https(u) {
    var s = str(u).trim();
    if (/^http:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|archive\.org|([a-z0-9-]+\.)*archive\.org|images-assets\.nasa\.gov|images-api\.nasa\.gov|www\.openbeelden\.nl)(\/|$)/i.test(s)) s = "https://" + s.slice(7);
    s = s.replace(/ /g, "%20");
    return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1500 ? s : "";
  }
  function qs(p) {
    return Object.keys(p).filter(function (k) { return p[k] !== "" && p[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k]); }).join("&");
  }
  // Words of a free-text query, safe inside an archive.org Lucene query.
  function iaWords(q) {
    return str(q).replace(/[\\+\-!(){}[\]^"~*?:/&|<>=]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  // "1:17:26" | "20:33" | "94 min" | "4646.42" (seconds) -> minutes
  function minutes(v, secsIfBare) {
    var s = str(v).trim().toLowerCase();
    if (!s) return 0;
    var m;
    if ((m = /^(\d{1,3}):(\d{1,2}):(\d{1,2})$/.exec(s))) return Math.round(+m[1] * 60 + +m[2] + +m[3] / 60);
    if ((m = /^(\d{1,3}):(\d{1,2})$/.exec(s))) return Math.max(1, Math.round(+m[1] + +m[2] / 60));
    if ((m = /^(\d+(?:\.\d+)?)\s*(min|mins|minutes|m)\b/.exec(s))) return Math.round(+m[1]);
    if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) { var n = +m[1]; return Math.round(secsIfBare ? n / 60 : n); }
    return 0;
  }
  function year(v) {
    var m = /(1[89]\d\d|20\d\d)/.exec(str(v));
    return m ? +m[1] : 0;
  }
  // US public domain by age: works published 95+ years ago (published
  // before 1931 in 2026).
  function ageLimit(now) { return new Date(now || Date.now()).getUTCFullYear() - 96; }

  // ---------- 2. Vocabularies ----------
  // Types shown as one filter: film, short, series, documentary,
  // animation, newsreel.
  var TYPES = ["film", "short", "series", "doc", "anim", "news"];
  // Genre ids -> Wikidata genres (P136) and Internet Archive subject words.
  var GENRES = {
    drama:     { wd: ["Q130232", "Q859369", "Q1919632", "Q113485322", "Q63214877", "Q7168625"], ia: "drama" },
    comedy:    { wd: ["Q157443", "Q859369", "Q860626", "Q118612349", "Q40831", "Q622548", "Q224700"], ia: "comedy" },
    romance:   { wd: ["Q1054574", "Q860626", "Q118612349"], ia: "romance" },
    crime:     { wd: ["Q959790", "Q19367312", "Q113485322", "Q185867", "Q496523"], ia: "crime" },
    noir:      { wd: ["Q185867"], ia: "noir" },
    horror:    { wd: ["Q200092", "Q1342372", "Q31888058", "Q3072049", "Q10663882", "Q224700", "Q18355406"], ia: "horror" },
    scifi:     { wd: ["Q471839", "Q2973181", "Q20443008", "Q10663882", "Q1065444"], ia: "science fiction" },
    fantasy:   { wd: ["Q157394", "Q1957385", "Q699"], ia: "fantasy" },
    adventure: { wd: ["Q319221", "Q222639", "Q2096633", "Q1433443"], ia: "adventure" },
    action:    { wd: ["Q188473"], ia: "action" },
    war:       { wd: ["Q369747"], ia: "war" },
    western:   { wd: ["Q172980"], ia: "western" },
    musical:   { wd: ["Q842256"], ia: "musical" },
    history:   { wd: ["Q17013749", "Q645928", "Q652256", "Q7168625"], ia: "history" },
    mystery:   { wd: ["Q1200678", "Q2484376", "Q2297927", "Q11304653", "Q109733304"], ia: "mystery" },
    family:    { wd: ["Q2143665", "Q1361932", "Q28026639"], ia: "children" },
    propaganda:{ wd: ["Q1935609"], ia: "propaganda" },
    education: { wd: ["Q596138"], ia: "educational" },
    experimental: { wd: ["Q790192"], ia: "experimental" }
  };
  var GENRE_IDS = Object.keys(GENRES);
  var WD_GENRE = {};
  GENRE_IDS.forEach(function (g) { GENRES[g].wd.forEach(function (q) { (WD_GENRE[q] = WD_GENRE[q] || []).push(g); }); });
  // Never listed (Chris: a free workspace for anyone).
  var WD_NEVER = { Q185529: 1 };
  // Wikidata item types (P31) that are films.
  var WD_TYPES = { Q11424: "film", Q24869: "film", Q506240: "film", Q24862: "short", Q93204: "doc", Q202866: "anim", Q226730: "film", Q21191270: "series" };
  // Roles of a video statement (P10 qualifier P3831) that are the whole work.
  var WD_FULL_ROLE = { "": 1, Q89347362: 1, Q1983062: 1, Q11424: 1 };
  // File names that are a part of a work, not the work.
  var NOT_FULL = /\b(trailer|teaser|clip|excerpt|scene|filming|behind the scenes|making of|promo|preview)\b/i;
  // Countries (P495) -> ISO 3166 codes ("su" Soviet Union).
  var WD_COUNTRY = {
    Q30: "us", Q15180: "su", Q142: "fr", Q17: "jp", Q129286: "in", Q668: "in", Q145: "gb", Q174193: "gb", Q183: "de", Q43287: "de",
    Q41304: "de", Q7318: "de", Q172579: "it", Q38: "it", Q35: "dk", Q34266: "ru", Q159: "ru", Q2305208: "ru", Q2184: "ru",
    Q139319: "ru", Q794: "ir", Q34: "se", Q13426199: "cn", Q148: "cn", Q865: "tw", Q155: "br", Q29: "es", Q55: "nl", Q96: "mx",
    Q31: "be", Q36: "pl", Q16: "ca", Q252: "id", Q45: "pt", Q20: "no", Q664: "nz", Q408: "au", Q130229: "ge", Q230: "ge",
    Q717: "ve", Q33: "fi", Q928: "ph", Q258: "za", Q28: "hu", Q414: "ar", Q40: "at", Q12560: "tr", Q43: "tr", Q884: "kr",
    Q79: "eg", Q403: "rs", Q948: "tn", Q298: "cl", Q212: "ua", Q184: "by", Q2895: "by", Q213: "cz", Q33946: "cz", Q241: "cu",
    Q227: "az", Q739: "co", Q27: "ie", Q191: "ee", Q39: "ch", Q77: "uy", Q41: "gr", Q218: "ro", Q219: "bg", Q37: "lt", Q211: "lv",
    Q224: "hr", Q215: "si", Q229: "cy", Q801: "il", Q843: "pk", Q902: "bd", Q881: "vn", Q837: "np", Q869: "th", Q833: "my"
  };
  // Languages (P364) -> ISO 639-1 ("zxx" no dialogue).
  var WD_LANG = {
    Q1860: "en", Q7976: "en", Q7979: "en", Q7737: "ru", Q1568: "hi", Q11051: "hi", Q188: "de", Q5287: "ja", Q150: "fr",
    Q5885: "ta", Q9168: "fa", Q3513637: "fa", Q9035: "da", Q1321: "es", Q9610: "bn", Q5146: "pt", Q750553: "pt", Q727694: "zh",
    Q9192: "zh", Q7850: "zh", Q262828: "zh", Q9186: "zh", Q652: "it", Q8097: "te", Q1571: "mr", Q809: "pl", Q9027: "sv",
    Q9240: "id", Q7411: "nl", Q1412: "fi", Q13955: "ar", Q34057: "tl", Q8108: "ka", Q9176: "ko", Q8798: "uk", Q9072: "et",
    Q9199: "vi", Q9091: "be", Q9043: "no", Q9056: "cs", Q36236: "ml", Q9246: "mn", Q14196: "af", Q7918: "bg", Q9288: "he",
    Q1617: "ur", Q9067: "hu", Q9237: "ms", Q9299: "sr", Q9129: "el", Q36510: "el", Q7913: "ro", Q256: "tr", Q22282939: "zxx"
  };
  // Internet Archive "language" values per ISO code (English name, MARC code).
  var IA_LANG = {
    en: ["English", "eng"], fr: ["French", "fre"], de: ["German", "ger"], it: ["Italian", "ita"], es: ["Spanish", "spa"],
    ru: ["Russian", "rus"], el: ["Greek", "gre"], ja: ["Japanese", "jpn"], pt: ["Portuguese", "por"], nl: ["Dutch", "dut"],
    sv: ["Swedish", "swe"], da: ["Danish", "dan"], pl: ["Polish", "pol"], zh: ["Chinese", "chi"], hi: ["Hindi", "hin"]
  };
  var IA_LANG_BACK = {};
  Object.keys(IA_LANG).forEach(function (c) { IA_LANG[c].forEach(function (n) { IA_LANG_BACK[n.toLowerCase()] = c; }); });

  // ---------- 3. Filters ----------
  // f: { ty, g, dec (decade start), c (country), l (language),
  //      len ("short" < 40 min | "long"), snd ("silent" | "sound"),
  //      src ("" | "wd" | "ia"), all (1 = also unchecked IA titles),
  //      sort ("pop" | "old" | "new" | "az") }
  var SORTS = ["pop", "old", "new", "az"];
  // wd Commons, ia Internet Archive, na NASA, eu Europeana (own key),
  // oi Open Images (Netherlands Institute for Sound & Vision, read
  // through Europeana), pt PeerTube (Sepia Search).
  var SOURCES = ["wd", "ia", "na", "eu", "oi", "pt"];
  function normFilter(f) {
    f = f && typeof f === "object" ? f : {};
    var o = {};
    if (TYPES.indexOf(f.ty) >= 0) o.ty = f.ty;
    if (GENRES[f.g]) o.g = f.g;
    var dec = Math.floor(+f.dec || 0);
    if (dec >= YEAR_MIN && dec <= 2100 && dec % 10 === 0) o.dec = dec;
    if (/^[a-z]{2}$/.test(str(f.c))) o.c = f.c;
    if (/^[a-z]{2,3}$/.test(str(f.l))) o.l = f.l;
    if (f.len === "short" || f.len === "long") o.len = f.len;
    if (f.snd === "silent" || f.snd === "sound") o.snd = f.snd;
    if (SOURCES.indexOf(f.src) >= 0) o.src = f.src;
    if (f.all === 1 || f.all === true) o.all = 1;
    if (SORTS.indexOf(f.sort) > 0) o.sort = f.sort;
    return o;
  }
  // Which of the chosen filters a source cannot apply: such a source is
  // left out (never results that ignore a filter, as Music MU-FIND).
  // The Internet Archive knows no country of production; NASA has only
  // documentaries and years; Europeana knows years, the archive's
  // country and the language; PeerTube knows language, length and a
  // few categories but not when a film was made.
  var CAN = {
    wd: { ty: 1, g: 1, dec: 1, c: 1, l: 1, len: 1, snd: 1 },
    ia: { ty: 1, g: 1, dec: 1, l: 1, len: 1, snd: 1 },
    na: { ty: "doc", dec: 1 },
    eu: { dec: 1, c: 1, l: 1 },
    oi: { dec: 1, c: 1, l: 1 },
    pt: { ty: "film news", g: "comedy", l: 1, len: 1 }
  };
  function filterMissing(src, f) {
    f = normFilter(f);
    var can = CAN[src] || {}, out = [];
    ["ty", "g", "dec", "c", "l", "len", "snd"].forEach(function (k) {
      if (f[k] == null) return;
      var c = can[k];
      if (!c || (typeof c === "string" && c.split(" ").indexOf(String(f[k])) < 0)) out.push(k);
    });
    return out;
  }
  function filterSupport(src, f) { return !filterMissing(src, f).length; }
  function isShort(it) { return it.ty === "short" || (it.d > 0 && it.d < 40); }
  function lenOk(it, len) {
    if (!len) return true;
    if (!it.d && it.ty !== "short") return false;
    return len === "short" ? isShort(it) : !isShort(it);
  }

  // ---------- 4. Internet Archive ----------
  // Curated film collections; the unsorted uploads are never asked.
  var IA_COLLS = ["feature_films", "silent_films", "classic_cartoons", "prelinger", "classic_tv", "SciFi_Horror",
    "Comedy_Films", "Film_Noir", "film_scifi", "newsandpublicaffairs"];
  var IA_NEVER = ["feature_films_unsorted", "opensource_movies"];
  var IA_FL = ["identifier", "title", "creator", "year", "date", "licenseurl", "collection", "downloads", "runtime",
    "language", "subject", "color", "sound"];
  function iaBase(f, now) {
    var q = "mediatype:(movies) AND collection:(" + IA_COLLS.join(" OR ") + ") AND -collection:(" + IA_NEVER.join(" OR ") + ")";
    if (!f.all) q += " AND (year:[" + YEAR_MIN + " TO " + ageLimit(now) + "] OR collection:(prelinger))";
    return q;
  }
  function iaSearchUrl(o) {
    o = o || {};
    var f = normFilter(o.f), parts = [];
    var w = iaWords(o.q);
    if (w) parts.push("(" + w + ")");
    if (f.ty === "series") parts.push("collection:(classic_tv)");
    else if (f.ty === "anim") parts.push("(collection:(classic_cartoons) OR subject:(cartoon OR animation OR animated))");
    else if (f.ty === "doc") parts.push("(collection:(prelinger) OR subject:(documentary))");
    else if (f.ty === "news") parts.push("(subject:(newsreel OR newsreels) OR collection:(newsandpublicaffairs))");
    else if (f.ty === "film" || f.ty === "short") parts.push("-collection:(classic_tv)");
    if (f.g) parts.push("subject:(" + iaWords(GENRES[f.g].ia) + ")");
    if (f.dec) parts.push("year:[" + f.dec + " TO " + (f.dec + 9) + "]");
    if (f.l && IA_LANG[f.l]) parts.push("language:(" + IA_LANG[f.l].map(function (x) { return '"' + x + '"'; }).join(" OR ") + ")");
    if (f.snd === "silent") parts.push("(sound:(silent) OR collection:(silent_films))");
    if (f.snd === "sound") parts.push("sound:(sound) AND -collection:(silent_films)");
    parts.push(iaBase(f, o.now));
    var sort = f.sort === "old" ? "year asc" : f.sort === "new" ? "year desc" : f.sort === "az" ? "titleSorter asc" : "downloads desc";
    var p = "q=" + encodeURIComponent(parts.join(" AND "));
    IA_FL.forEach(function (x) { p += "&fl%5B%5D=" + x; });
    p += "&sort%5B%5D=" + encodeURIComponent(sort);
    p += "&rows=" + PAGE + "&page=" + Math.max(1, Math.floor(+o.page || 1)) + "&output=json";
    return "https://archive.org/advancedsearch.php?" + p;
  }
  function iaId(id) { return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? id : ""; }
  function arr(v) { return Array.isArray(v) ? v : v == null || v === "" ? [] : [v]; }
  function iaRights(d, now) {
    var cs = arr(d.collection).map(str);
    if (cs.indexOf("prelinger") >= 0) return "prelinger";
    var y = year(d.year) || year(d.date);
    if (y && y <= ageLimit(now)) return "age";
    return "listed";
  }
  function iaItem(d, now) {
    if (!d || typeof d !== "object") return null;
    var id = iaId(d.identifier);
    if (!id) return null;
    var cs = arr(d.collection).map(str);
    if (cs.some(function (c) { return IA_NEVER.indexOf(c) >= 0; })) return null;
    var subj = arr(d.subject).map(function (s) { return fold(s); }).join(" | ");
    var ty = cs.indexOf("classic_tv") >= 0 ? "series"
      : cs.indexOf("classic_cartoons") >= 0 || /\b(cartoon|animation|animated)\b/.test(subj) ? "anim"
      : /\bnewsreels?\b/.test(subj) || cs.indexOf("newsandpublicaffairs") >= 0 ? "news"
      : cs.indexOf("prelinger") >= 0 || /\bdocumentar/.test(subj) ? "doc" : "film";
    var d0 = minutes(d.runtime, false);
    if (ty === "film" && d0 > 0 && d0 < 40) ty = "short";
    var g = GENRE_IDS.filter(function (k) { return subj.indexOf(fold(GENRES[k].ia)) >= 0; });
    var langs = [];
    arr(d.language).forEach(function (l) { var c = IA_LANG_BACK[fold(l)]; if (c && langs.indexOf(c) < 0) langs.push(c); });
    var snd = /silent/i.test(str(d.sound)) || cs.indexOf("silent_films") >= 0 ? "silent" : /sound/i.test(str(d.sound)) ? "sound" : "";
    var col = /b ?& ?w|black|white/i.test(str(d.color)) ? "bw" : /colou?r/i.test(str(d.color)) ? "color" : "";
    var why = iaRights(d, now);
    var title = clip(d.title, 200) || id;
    return item({
      k: "ia:" + id, s: "ia", t: title, y: year(d.year) || year(d.date), d: d0, ty: ty, g: g, c: [], l: langs,
      dir: clip(arr(d.creator).map(str).join(", "), 160), im: "https://archive.org/services/img/" + encodeURIComponent(id),
      sl: Math.max(0, Math.floor(+d.downloads || 0)), ok: why === "listed" ? 0 : 1, why: why, snd: snd, col: col
    });
  }
  function iaParseSearch(j, o) {
    o = o || {};
    var r = j && j.response;
    var docs = r && Array.isArray(r.docs) ? r.docs : [];
    var f = normFilter(o.f);
    var items = docs.map(function (d) { return iaItem(d, o.now); }).filter(function (it) {
      return it && (f.all || it.ok) && lenOk(it, f.len) && (!f.ty || it.ty === f.ty || (f.ty === "film" && it.ty !== "short" && it.ty !== "series"));
    });
    var total = r && typeof r.numFound === "number" ? r.numFound : items.length;
    var page = Math.max(1, Math.floor(+o.page || 1));
    return { items: items, total: total, more: docs.length >= PAGE && page * PAGE < total };
  }
  function iaMetaUrl(id) { return "https://archive.org/metadata/" + encodeURIComponent(iaId(id)); }
  function iaPath(id, name) { return "https://archive.org/download/" + encodeURIComponent(id) + "/" + str(name).split("/").map(encodeURIComponent).join("/"); }
  // Video formats the Internet Archive derives, best for a browser first.
  var IA_VIDEO = ["h.264", "h.264 IA", "MPEG4", "h.264 HD", "512Kb MPEG4", "Ogg Video"];
  function stripHtml(s) {
    return str(s).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  }
  // -> { parts: [{ url, name, min, ogg }], desc, page, closed } | null
  function iaParseMeta(j, idIn) {
    var id = iaId(idIn);
    if (!id || !j || typeof j !== "object") return null;
    if (j.is_dark || !j.metadata || !Array.isArray(j.files)) return { closed: 1, parts: [] };
    var m = j.metadata;
    var best = {};   // original -> { rank, file }
    j.files.forEach(function (f) {
      if (!f || typeof f.name !== "string") return;
      var rank = IA_VIDEO.indexOf(str(f.format));
      if (rank < 0) return;
      if (/(^|\/)__ia_|\.gif$|_sample\./i.test(f.name)) return;
      var key = str(f.original) || f.name;
      var b = best[key];
      if (!b || rank < b.rank) best[key] = { rank: rank, f: f };
    });
    var parts = Object.keys(best).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).map(function (k) {
      var f = best[k].f;
      var nm = str(f.title) || k.replace(/^.*\//, "").replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[_]+/g, " ");
      return { url: iaPath(id, f.name), name: clip(nm, 160), min: minutes(f.length, true), ogg: str(f.format) === "Ogg Video" ? 1 : 0 };
    }).slice(0, 200);
    var subs = j.files.filter(function (f) { return f && typeof f.name === "string" && /\.(srt|vtt)$/i.test(f.name) && !/(^|\/)__ia_/.test(f.name); })
      .slice(0, 12).map(function (f) {
        return { l: subLang(f.name), url: iaPath(id, f.name), srt: /\.srt$/i.test(f.name) ? 1 : 0, auto: /\.asr\./i.test(f.name) ? 1 : 0, name: clip(f.name, 120) };
      });
    return {
      parts: parts, closed: parts.length ? 0 : 1, subs: subs,
      desc: clip(stripHtml(m.description), 2000),
      page: "https://archive.org/details/" + encodeURIComponent(id),
      lic: str(m.licenseurl)
    };
  }

  // ---------- 5. Wikidata + Commons ----------
  var WD_TYPE_VALUES = "VALUES ?t { " + Object.keys(WD_TYPES).map(function (q) { return "wd:" + q; }).join(" ") + " }";
  var WD_QUERIES = {
    main: "SELECT ?item ?t ?video ?r ?pd ?d ?im ?ser ?sl WHERE { " + WD_TYPE_VALUES +
      " ?item wdt:P31 ?t; p:P10 ?vst. ?vst ps:P10 ?video. OPTIONAL { ?vst pq:P3831 ?r } OPTIONAL { ?item wdt:P577 ?pd }" +
      " OPTIONAL { ?item wdt:P2047 ?d } OPTIONAL { ?item wdt:P18 ?im } OPTIONAL { ?item wdt:P179 ?ser }" +
      " OPTIONAL { ?item wikibase:sitelinks ?sl } }",
    facets: "SELECT ?item ?p ?o WHERE { " + WD_TYPE_VALUES +
      " ?item wdt:P31 ?t; wdt:P10 []. VALUES ?p { wdt:P136 wdt:P495 wdt:P364 } ?item ?p ?o. }",
    dirs: "SELECT ?item ?n WHERE { " + WD_TYPE_VALUES +
      " ?item wdt:P31 ?t; wdt:P10 []; wdt:P57 ?dir. ?dir rdfs:label ?n FILTER(LANG(?n) = \"en\") }",
    labels: "SELECT ?item ?l WHERE { { " + WD_TYPE_VALUES + " ?item wdt:P31 ?t; wdt:P10 []. } UNION" +
      " { ?x wdt:P31 wd:Q21191270; wdt:P10 []; wdt:P179 ?item. } ?item rdfs:label ?l." +
      " FILTER(LANG(?l) = \"en\" || LANG(?l) = \"el\" || LANG(?l) = \"de\") }"
  };
  function wdQueryUrl(sparql) { return "https://query.wikidata.org/sparql?" + qs({ query: sparql }); }
  // One cell of SPARQL TSV -> { v, lang?, uri? }
  function tsvCell(s) {
    s = str(s);
    if (!s) return null;
    if (s.charAt(0) === "<" && s.charAt(s.length - 1) === ">") return { v: s.slice(1, -1), uri: 1 };
    if (s.charAt(0) === '"') {
      var end = s.lastIndexOf('"');
      if (end <= 0) return null;
      var raw = s.slice(1, end), rest = s.slice(end + 1);
      var v = raw.replace(/\\(.)/g, function (m, c) { return c === "t" ? "\t" : c === "n" ? "\n" : c === "r" ? "" : c; });
      var lm = /^@([a-zA-Z-]+)$/.exec(rest);
      return { v: v, lang: lm ? lm[1].toLowerCase() : "" };
    }
    return { v: s };
  }
  // SPARQL TSV -> [{ var: cell }]
  function parseTsv(text) {
    var lines = str(text).split(/\r?\n/), out = [];
    if (!lines.length) return out;
    var head = lines[0].split("\t").map(function (h) { return h.replace(/^\?/, ""); });
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      var cells = lines[i].split("\t"), row = {};
      for (var c = 0; c < head.length; c++) { var x = tsvCell(cells[c]); if (x) row[head[c]] = x; }
      out.push(row);
    }
    return out;
  }
  function qid(cell) {
    var m = cell && /\/entity\/(Q\d{1,12})$/.exec(cell.v);
    return m ? m[1] : "";
  }
  // "http://commons.wikimedia.org/wiki/Special:FilePath/Nosferatu%20%281922%29.webm" -> "Nosferatu (1922).webm"
  function commonsFile(cell) {
    var m = cell && /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/(.+)$/.exec(cell.v);
    if (!m) return "";
    var f;
    try { f = decodeURIComponent(m[1]); } catch (e) { return ""; }
    return f.length <= 240 && !/[\u0000-\u001f<>"{}|]/.test(f) ? f : "";
  }
  function filePath(file, width) {
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file).replace(/%20/g, "_") + (width ? "?width=" + width : "");
  }
  // tsv: { main, facets, dirs, labels } (texts) -> items sorted by popularity
  function wdBuild(tsv) {
    tsv = tsv || {};
    var by = {}, order = [];
    function get(q) { if (!by[q]) { by[q] = { q: q, t: {}, v: [], bad: 0, types: {}, g: {}, c: {}, l: {}, dir: [], y: 0, d: 0, im: "", ser: "", sl: 0 }; order.push(q); } return by[q]; }
    parseTsv(tsv.main).forEach(function (r) {
      var q = qid(r.item); if (!q) return;
      var e = get(q);
      var ty = WD_TYPES[qid(r.t)]; if (ty) e.types[ty] = 1;
      var file = commonsFile(r.video);
      var role = qid(r.r);
      // A statement without a role is taken as the whole work unless its
      // file says otherwise; an episode needs the explicit role.
      if (file && WD_FULL_ROLE[role] && !(role === "" && (WD_TYPES[qid(r.t)] === "series" || NOT_FULL.test(file)))) {
        if (e.v.indexOf(file) < 0) e.v.push(file);
      }
      var y = year(r.pd && r.pd.v); if (y && (!e.y || y < e.y)) e.y = y;
      var dm = r.d ? +r.d.v : 0; if (dm > 0 && !e.d) e.d = Math.round(dm > 600 ? dm / 60 : dm);
      var im = commonsFile(r.im); if (im && !e.im) e.im = im;
      var ser = qid(r.ser); if (ser && !e.ser) e.ser = ser;
      var sl = r.sl ? Math.floor(+r.sl.v) || 0 : 0; if (sl > e.sl) e.sl = sl;
    });
    parseTsv(tsv.facets).forEach(function (r) {
      var e = by[qid(r.item)]; if (!e) return;
      var p = /\/(P\d+)$/.exec(r.p ? r.p.v : ""), o = qid(r.o);
      if (!p || !o) return;
      if (p[1] === "P136") {
        if (WD_NEVER[o]) e.bad = 1;
        (WD_GENRE[o] || []).forEach(function (g) { e.g[g] = 1; });
        if (WD_TYPES[o] && WD_TYPES[o] !== "film") e.types[WD_TYPES[o]] = 1;
        if (o === "Q226730") e.silent = 1;
        if (o === "Q848512") e.sound = 1;
      } else if (p[1] === "P495") { if (WD_COUNTRY[o]) e.c[WD_COUNTRY[o]] = 1; }
      else if (p[1] === "P364") { if (WD_LANG[o]) e.l[WD_LANG[o]] = 1; }
    });
    parseTsv(tsv.dirs).forEach(function (r) {
      var e = by[qid(r.item)]; if (!e || !r.n) return;
      var n = clip(r.n.v, 80); if (n && e.dir.indexOf(n) < 0 && e.dir.length < 3) e.dir.push(n);
    });
    var series = {};
    parseTsv(tsv.labels).forEach(function (r) {
      var q = qid(r.item); if (!q || !r.l) return;
      var lang = r.l.lang;
      if (lang !== "en" && lang !== "el" && lang !== "de") return;
      var e = by[q];
      var target = e ? e.t : (series[q] = series[q] || {});
      if (!target[lang]) target[lang] = clip(r.l.v, 200);
    });
    var items = [];
    order.forEach(function (q) {
      var e = by[q];
      if (e.bad || !e.v.length) return;
      var ty = e.types.series ? "series" : e.types.doc ? "doc" : e.types.anim ? "anim" : e.types.short ? "short" : "film";
      if (ty === "film" && e.d > 0 && e.d < 40) ty = "short";
      var t = e.t.en || e.t.de || e.t.el || q;
      e.v.sort();
      var it = item({
        k: "wd:" + q, s: "wd", t: t, tl: e.t, y: e.y, d: e.d, ty: ty, g: Object.keys(e.g).sort(),
        c: Object.keys(e.c).sort(), l: Object.keys(e.l).sort(), dir: e.dir.join(", "),
        im: e.im ? filePath(e.im, 320) : filePath(e.v[0], 320), v: e.v.slice(0, 40),
        ser: e.ser ? "wd:" + e.ser : "", sl: e.sl, ok: 1, why: "commons",
        snd: e.silent || (e.l.zxx && !e.sound) ? "silent" : e.sound || Object.keys(e.l).some(function (x) { return x !== "zxx"; }) ? "sound" : ""
      });
      if (!it) return;
      if (it.ser && series[e.ser]) it.st = series[e.ser];
      items.push(it);
    });
    items.sort(function (a, b) { return b.sl - a.sl || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
    return items.slice(0, MAX_WD);
  }
  function titleIn(it, lang) {
    var tl = it.tl || {};
    return tl[lang] || it.t || "";
  }
  // Catalogue search + filters on the device. o: { q, f, page, lang }
  function wdFilter(items, o) {
    o = o || {};
    var f = normFilter(o.f), page = Math.max(1, Math.floor(+o.page || 1));
    var words = fold(o.q).split(/\s+/).filter(Boolean);
    var hits = (Array.isArray(items) ? items : []).filter(function (it) {
      if (!it) return false;
      if (f.ty && it.ty !== f.ty) return false;
      if (f.g && (it.g || []).indexOf(f.g) < 0) return false;
      if (f.dec && !(it.y >= f.dec && it.y <= f.dec + 9)) return false;
      if (f.c && (it.c || []).indexOf(f.c) < 0) return false;
      if (f.l && (it.l || []).indexOf(f.l) < 0) return false;
      if (f.snd && it.snd !== f.snd) return false;
      if (!lenOk(it, f.len)) return false;
      if (words.length) {
        var hay = fold([it.t, (it.tl || {}).el, (it.tl || {}).de, it.dir, it.y, (it.st || {}).en, (it.st || {}).el].join(" "));
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    var lang = o.lang || "en";
    if (f.sort === "old") hits.sort(function (a, b) { return (a.y || 9999) - (b.y || 9999) || b.sl - a.sl; });
    else if (f.sort === "new") hits.sort(function (a, b) { return (b.y || 0) - (a.y || 0) || b.sl - a.sl; });
    else if (f.sort === "az") hits.sort(function (a, b) { var x = fold(titleIn(a, lang)), y = fold(titleIn(b, lang)); return x < y ? -1 : x > y ? 1 : 0; });
    return { items: hits.slice((page - 1) * PAGE, page * PAGE), total: hits.length, more: hits.length > page * PAGE };
  }
  // Commons file information: the transcodes to choose from and the licence.
  function commonsInfoUrl(file) {
    return "https://commons.wikimedia.org/w/api.php?" + qs({
      action: "query", format: "json", origin: "*", formatversion: "2",
      titles: "File:" + str(file), prop: "videoinfo",
      viprop: "url|size|mime|derivatives|extmetadata",
      viextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit"
    });
  }
  // canPlay(mime) -> "" | "maybe" | "probably" (HTMLMediaElement.canPlayType)
  // -> { url, mime, h, lic, licUrl, page } | null
  function commonsPick(j, canPlay) {
    var pages = j && j.query && j.query.pages;
    var p = Array.isArray(pages) ? pages[0] : pages && typeof pages === "object" ? pages[Object.keys(pages)[0]] : null;
    var vi = p && (Array.isArray(p.videoinfo) ? p.videoinfo[0] : Array.isArray(p.imageinfo) ? p.imageinfo[0] : null);
    if (!vi) return null;
    var can = typeof canPlay === "function" ? canPlay : function () { return "maybe"; };
    var cands = [];
    (Array.isArray(vi.derivatives) ? vi.derivatives : []).forEach(function (d) {
      var u = https(d && d.src), type = str(d && d.type);
      if (!u || /dash\+xml|mpegurl/i.test(type)) return;
      var h = Math.floor(+d.height || 0);
      cands.push({ url: u, mime: type, h: h });
    });
    var orig = https(vi.url);
    if (orig) cands.push({ url: orig.replace(/\?.*$/, ""), mime: str(vi.mime), h: Math.floor(+vi.height || 0), orig: 1 });
    // Playable here, closest to 720 lines without going far above, lighter first.
    var ok = cands.filter(function (c) { return can(c.mime.split(";")[0]) && (c.mime.indexOf("codecs") < 0 || can(c.mime)); });
    if (!ok.length) return null;
    function score(c) { var h = c.h || 480; return (h > 1080 ? 2000 : 0) + Math.abs(720 - h) + (c.orig ? 50 : 0); }
    ok.sort(function (a, b) { return score(a) - score(b); });
    var em = vi.extmetadata || {};
    function emv(k) { return em[k] && typeof em[k].value === "string" ? clip(stripHtml(em[k].value), 200) : ""; }
    return {
      url: ok[0].url, mime: ok[0].mime, h: ok[0].h,
      lic: emv("LicenseShortName"), licUrl: https(emv("LicenseUrl")), artist: emv("Artist"),
      page: https(vi.descriptionurl) || ""
    };
  }

  // ---------- 6. The one item shape ----------
  var TY_OK = {}; TYPES.forEach(function (t) { TY_OK[t] = 1; });
  var WHY_RE = /^(commons|age|prelinger|listed|nasa|open|pt)$/;
  function codes(a, re, n) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (x) { if (typeof x === "string" && re.test(x) && out.indexOf(x) < 0 && out.length < n) out.push(x); });
    return out;
  }
  function item(o) {
    if (!o || typeof o !== "object") return null;
    var k = str(o.k);
    if (!KEY_RE.test(k)) return null;
    var it = { k: k, s: k.slice(0, 2), t: clip(o.t, 200) || k };
    if (o.tl && typeof o.tl === "object") {
      var tl = {};
      ["en", "el", "de"].forEach(function (l) { var v = clip(o.tl[l], 200); if (v) tl[l] = v; });
      if (Object.keys(tl).length) it.tl = tl;
    }
    if (o.st && typeof o.st === "object") {
      var st = {};
      ["en", "el", "de"].forEach(function (l) { var v = clip(o.st[l], 200); if (v) st[l] = v; });
      if (Object.keys(st).length) it.st = st;
    }
    var y = Math.floor(+o.y || 0); if (y >= YEAR_MIN && y <= 2100) it.y = y;
    var d = Math.floor(+o.d || 0); if (d > 0 && d < 2000) it.d = d;
    it.ty = TY_OK[o.ty] ? o.ty : "film";
    var g = codes(o.g, /^[a-z]{2,14}$/, 8).filter(function (x) { return !!GENRES[x]; }); if (g.length) it.g = g;
    var c = codes(o.c, /^[a-z]{2}$/, 6); if (c.length) it.c = c;
    var l = codes(o.l, /^[a-z]{2,3}$/, 6); if (l.length) it.l = l;
    var dir = clip(o.dir, 160); if (dir) it.dir = dir;
    var im = https(o.im); if (im) it.im = im;
    if (Array.isArray(o.v)) { var v = o.v.filter(function (x) { return typeof x === "string" && x.length <= 240 && !/[\u0000-\u001f<>"{}|]/.test(x); }).slice(0, 40); if (v.length) it.v = v; }
    if (/^wd:Q\d{1,12}$/.test(str(o.ser))) it.ser = o.ser;
    var sl = Math.floor(+o.sl || 0); it.sl = sl > 0 ? sl : 0;
    it.ok = o.ok ? 1 : 0;
    it.why = WHY_RE.test(str(o.why)) ? o.why : (it.ok ? "commons" : "listed");
    if (o.snd === "silent" || o.snd === "sound") it.snd = o.snd;
    if (o.col === "bw" || o.col === "color") it.col = o.col;
    var u = https(o.u); if (u) it.u = u;
    var lic = clip(o.lic, 80); if (lic) it.lic = lic;
    var pg = https(o.pg); if (pg) it.pg = pg;
    var ds = clip(o.ds, 600); if (ds) it.ds = ds;
    var by = clip(o.by, 120); if (by) it.by = by;
    return it;
  }

  // ---------- 7. Synced fields of the TELEVISION slice ----------
  // wl  watchlist     { <k>: { t, y?, im?, ty, w?, m, x? } }   x = removed
  // ss  saved searches { <id>: { n name, q?, f?, m, x? } }   (TV-VOD2)
  // rp  resume points { <k>: { t, y?, im?, ty, w?, p, d, n?, m, f?, x? } }
  //      w = why an Internet Archive title is free (age | prelinger | listed).
  //      p = seconds watched, d = length in seconds, n = part (0 = first),
  //      f = finished.
  // Per-key last-writer-wins by m (tie: larger JSON), so the merge is
  // symmetric, idempotent and associative; a removal is an entry too
  // (x: 1), which keeps a removed title from coming back. Written only
  // when non-empty, keys sorted (old data loads unchanged).
  function entry(e, kind) {
    if (!e || typeof e !== "object") return null;
    var m = Math.floor(+e.m || 0);
    if (!(m > 0)) return null;
    var o = { m: m };
    if (e.x) { o.x = 1; return o; }
    if (kind === "ss") {
      o.n = clip(e.n, 80);
      var q = clip(e.q, 120); if (q) o.q = q;
      var f = normFilter(e.f); if (Object.keys(f).length) o.f = f;
      return o.n || o.q || o.f ? o : null;
    }
    o.t = clip(e.t, 200);
    var y = Math.floor(+e.y || 0); if (y >= YEAR_MIN && y <= 2100) o.y = y;
    var im = https(e.im); if (im) o.im = im;
    o.ty = TY_OK[e.ty] ? e.ty : "film";
    if (/^(age|prelinger|listed|nasa|open|pt)$/.test(str(e.w))) o.w = e.w;
    if (kind === "rp") {
      var p = Math.floor(+e.p || 0), d = Math.floor(+e.d || 0);
      o.p = p > 0 && p < 360000 ? p : 0;
      o.d = d > 0 && d < 360000 ? d : 0;
      if (e.f) o.f = 1;
      var n = Math.floor(+e.n || 0); if (n > 0 && n < 200) o.n = n;
    }
    return o;
  }
  function better(a, b) {
    if (!a) return b; if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function capMap(map, n) {
    var ks = Object.keys(map);
    if (ks.length <= n) return map;
    ks.sort(function (a, b) { return map[b].m - map[a].m || (a < b ? -1 : a > b ? 1 : 0); });
    var out = {};
    ks.slice(0, n).forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  function normMap(src, kind, cap) {
    var out = {};
    if (src && typeof src === "object" && !Array.isArray(src)) {
      var re = kind === "ss" ? SS_KEY : KEY_RE;
      Object.keys(src).forEach(function (k) {
        if (!re.test(k)) return;
        var e = entry(src[k], kind);
        if (e) out[k] = e;
      });
    }
    out = capMap(out, cap);
    var sorted = {};
    Object.keys(out).sort().forEach(function (k) { sorted[k] = out[k]; });
    return sorted;
  }
  // In place: obj.wl / obj.rp / obj.ss canonical, absent when empty.
  function normVod(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var wl = normMap(obj.wl, "wl", MAX_WATCH), rp = normMap(obj.rp, "rp", MAX_RESUME), ss = normMap(obj.ss, "ss", MAX_SAVED);
    delete obj.wl; delete obj.rp; delete obj.ss;
    if (Object.keys(wl).length) obj.wl = wl;
    if (Object.keys(rp).length) obj.rp = rp;
    if (Object.keys(ss).length) obj.ss = ss;
    return obj;
  }
  function mergeMap(a, b, kind, cap) {
    var A = normMap(a, kind, Infinity), B = normMap(b, kind, Infinity), out = {};
    Object.keys(A).concat(Object.keys(B)).forEach(function (k) { out[k] = better(A[k], B[k]); });
    return normMap(out, kind, cap);
  }
  // Writes wl / rp of remote ∪ local into `into` (or a new object).
  function mergeVod(remote, local, into) {
    var out = into || {};
    var wl = mergeMap(remote && remote.wl, local && local.wl, "wl", MAX_WATCH);
    var rp = mergeMap(remote && remote.rp, local && local.rp, "rp", MAX_RESUME);
    var ss = mergeMap(remote && remote.ss, local && local.ss, "ss", MAX_SAVED);
    delete out.wl; delete out.rp; delete out.ss;
    if (Object.keys(wl).length) out.wl = wl;
    if (Object.keys(rp).length) out.rp = rp;
    if (Object.keys(ss).length) out.ss = ss;
    return out;
  }
  function stamp(prev, now) { return Math.max(Math.floor(+now || Date.now()), prev ? prev.m + 1 : 0); }
  function card(it) {
    var o = { t: it.t, ty: it.ty };
    if (it.y) o.y = it.y;
    if (it.im) o.im = it.im;
    if (it.s !== "wd" && /^(age|prelinger|listed|nasa|open|pt)$/.test(str(it.why))) o.w = it.why;
    return o;
  }
  function watchOn(obj, k) { var e = obj && obj.wl && obj.wl[k]; return !!(e && !e.x); }
  // Returns true when something changed.
  function setWatch(obj, it, on, now) {
    if (!obj || !it || !KEY_RE.test(it.k)) return false;
    if (watchOn(obj, it.k) === !!on) return false;
    var prev = obj.wl && obj.wl[it.k];
    var e = on ? card(it) : { x: 1 };
    e.m = stamp(prev, now);
    obj.wl = obj.wl || {};
    obj.wl[it.k] = e;
    normVod(obj);
    return true;
  }
  function resumeOf(obj, k) {
    var e = obj && obj.rp && obj.rp[k];
    return e && !e.x && !e.f && (e.p >= 30 || e.n) ? e : null;
  }
  // pos / dur in seconds, part = which part of a work in parts (0 first).
  // Finished = within 3 minutes or 5% of the end of the last part.
  function setResume(obj, it, pos, dur, now, part, parts) {
    if (!obj || !it || !KEY_RE.test(it.k)) return false;
    var p = Math.max(0, Math.floor(+pos || 0)), d = Math.max(0, Math.floor(+dur || 0));
    var n = Math.max(0, Math.min(199, Math.floor(+part || 0)));
    var last = n >= Math.max(1, Math.floor(+parts || 1)) - 1;
    var fin = last && d > 0 && (p >= d - 180 || p >= d * 0.95);
    var prev = obj.rp && obj.rp[it.k];
    if (prev && !prev.x && prev.p === p && (prev.n || 0) === n && !!prev.f === fin) return false;
    if (!prev && p < 30 && !n && !fin) return false;
    var e = card(it);
    e.p = fin ? d : p; e.d = d;
    if (n) e.n = n;
    if (fin) e.f = 1;
    e.m = stamp(prev, now);
    obj.rp = obj.rp || {};
    obj.rp[it.k] = e;
    normVod(obj);
    return true;
  }
  function dropResume(obj, k, now) {
    var prev = obj && obj.rp && obj.rp[k];
    if (!prev || prev.x) return false;
    obj.rp[k] = { x: 1, m: stamp(prev, now) };
    normVod(obj);
    return true;
  }
  function listOf(map, keep) {
    return Object.keys(map || {}).filter(function (k) { return keep(map[k]); })
      .sort(function (a, b) { return map[b].m - map[a].m || (a < b ? -1 : 1); })
      .map(function (k) {
        var e = map[k];
        // Why it is free travels with the entry (w), so the lists show
        // the same note as the search did.
        var why = k.charAt(0) === "w" ? "commons" : e.w || "listed";
        var it = item({ k: k, t: e.t, y: e.y, im: e.im, ty: e.ty, ok: why === "listed" ? 0 : 1, why: why });
        if (it && e.p != null) { it.p = e.p; it.dd = e.d; if (e.n) it.n = e.n; }
        return it;
      }).filter(Boolean);
  }
  function continueList(obj) { return listOf(obj && obj.rp, function (e) { return !e.x && !e.f && (e.p >= 30 || e.n); }); }
  function watchList(obj) { return listOf(obj && obj.wl, function (e) { return !e.x; }); }

  // Saved searches (synced, D4): newest first.
  function savedList(obj) {
    var m = obj && obj.ss || {};
    return Object.keys(m).filter(function (k) { return !m[k].x; })
      .sort(function (a, b) { return m[b].m - m[a].m || (a < b ? -1 : 1); })
      .map(function (k) { return { id: k, n: m[k].n, q: m[k].q || "", f: m[k].f || {} }; });
  }
  function sameSearch(a, b) { return fold(a.q || "") === fold(b.q || "") && JSON.stringify(normFilter(a.f)) === JSON.stringify(normFilter(b.f)); }
  // -> the id saved, or "" when nothing changed (the same search is there).
  function saveSearch(obj, o, now, id) {
    if (!obj || !o) return "";
    var q = clip(o.q, 120), f = normFilter(o.f);
    if (!q && !Object.keys(f).length) return "";
    if (savedList(obj).some(function (x) { return sameSearch(x, { q: q, f: f }); })) return "";
    id = SS_KEY.test(str(id)) ? id : "s" + Math.floor(+now || Date.now()).toString(36);
    var prev = obj.ss && obj.ss[id];
    var e = { n: clip(o.n, 80) || q || "?", m: stamp(prev, now) };
    if (q) e.q = q;
    if (Object.keys(f).length) e.f = f;
    obj.ss = obj.ss || {};
    obj.ss[id] = e;
    normVod(obj);
    return obj.ss && obj.ss[id] ? id : "";
  }
  function dropSearch(obj, id, now) {
    var prev = obj && obj.ss && obj.ss[id];
    if (!prev || prev.x) return false;
    obj.ss[id] = { x: 1, m: stamp(prev, now) };
    normVod(obj);
    return true;
  }

  // ---------- 8. More sources (TV-VOD2) ----------
  // na  NASA Image and Video Library: works of the US government, in
  //     the public domain (NASA media guidelines; a credit line names
  //     any other owner). No key; search and asset lists answer CORS.
  function naId(id) { return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9 _.,'()-]{0,150}$/.test(id) ? id : ""; }
  function naSearchUrl(o) {
    o = o || {};
    var f = normFilter(o.f), p = { media_type: "video", page_size: PAGE, page: Math.max(1, Math.floor(+o.page || 1)) };
    var q = clip(o.q, 120);
    if (q) p.q = q;
    if (f.dec) { p.year_start = f.dec; p.year_end = f.dec + 9; }
    return "https://images-api.nasa.gov/search?" + qs(p);
  }
  function naParseSearch(j, o) {
    var c = j && j.collection;
    var list = c && Array.isArray(c.items) ? c.items : [];
    var items = list.map(function (x) {
      var d = x && Array.isArray(x.data) ? x.data[0] : null;
      if (!d || d.media_type !== "video" || !naId(d.nasa_id)) return null;
      var im = "";
      (Array.isArray(x.links) ? x.links : []).some(function (l) {
        if (l && l.render === "image" && /~(medium|small|thumb)\.jpg$/.test(str(l.href))) { im = https(l.href); return true; }
        return false;
      });
      return item({
        k: "na:" + d.nasa_id, t: clip(d.title, 200) || d.nasa_id, y: year(d.date_created), ty: "doc",
        im: im, ok: 1, why: "nasa", lic: "Public domain (NASA)", by: clip(d.secondary_creator || d.photographer || d.center, 120),
        ds: clip(stripHtml(d.description), 600), pg: "https://images.nasa.gov/details/" + encodeURIComponent(d.nasa_id)
      });
    }).filter(Boolean);
    var total = c && c.metadata && typeof c.metadata.total_hits === "number" ? c.metadata.total_hits : items.length;
    var page = Math.max(1, Math.floor(+(o && o.page) || 1));
    return { items: items, total: total, more: list.length >= PAGE && page * PAGE < Math.min(total, 10000) };
  }
  function naAssetUrl(id) { return "https://images-api.nasa.gov/asset/" + encodeURIComponent(naId(id)); }
  // -> { url, subs: [{ l, url, srt }] } | null. Medium first (light,
  // about 720 lines), then the other sizes; the original last.
  var NA_SIZES = ["medium", "large", "mobile", "small", "orig"];
  function naParseAsset(j) {
    var hrefs = (j && j.collection && Array.isArray(j.collection.items) ? j.collection.items : [])
      .map(function (x) { return https(x && x.href); }).filter(Boolean);
    var url = "";
    NA_SIZES.some(function (sz) {
      var re = new RegExp("~" + sz + "\\.mp4$", "i");
      return hrefs.some(function (h) { if (re.test(h)) { url = h; return true; } return false; });
    });
    if (!url) hrefs.some(function (h) { if (/\.mp4$/i.test(h)) { url = h; return true; } return false; });
    if (!url) return null;
    var subs = hrefs.filter(function (h) { return /\.(srt|vtt)$/i.test(h); }).slice(0, 4).map(function (h) {
      return { l: "en", url: h, srt: /\.srt$/i.test(h) ? 1 : 0 };
    });
    return { url: url, subs: subs };
  }

  // eu  Europeana (each user's own free key, shared with Music, lb.js
  //     secret "europeana"): videos with an open licence (reusability
  //     = open: public domain, CC0, BY, BY-SA) whose file a browser can
  //     play (MIME video/mp4 or video/ogg, given as two qf: Europeana
  //     ORs the same field). oi = the Netherlands Institute for Sound &
  //     Vision (Open Images) from the same API, shown as its own source;
  //     eu leaves that provider out so nothing shows twice.
  var OI_PROVIDER = "Netherlands Institute for Sound & Vision";
  var EU_COUNTRY = {
    at: "Austria", be: "Belgium", bg: "Bulgaria", hr: "Croatia", cy: "Cyprus", cz: "Czech Republic", dk: "Denmark",
    ee: "Estonia", fi: "Finland", fr: "France", de: "Germany", gr: "Greece", hu: "Hungary", ie: "Ireland", it: "Italy",
    lv: "Latvia", lt: "Lithuania", lu: "Luxembourg", mt: "Malta", nl: "Netherlands", pl: "Poland", pt: "Portugal",
    ro: "Romania", sk: "Slovakia", si: "Slovenia", es: "Spain", se: "Sweden", gb: "United Kingdom", no: "Norway",
    ch: "Switzerland", rs: "Serbia", ua: "Ukraine", is: "Iceland", me: "Montenegro", mk: "North Macedonia", al: "Albania"
  };
  var EU_COUNTRY_BACK = {};
  Object.keys(EU_COUNTRY).forEach(function (c) { EU_COUNTRY_BACK[EU_COUNTRY[c].toLowerCase()] = c; });
  function euKeyOk(k) { return typeof k === "string" && /^[A-Za-z0-9]{4,40}$/.test(k.trim()); }
  function euWords(q) { return str(q).replace(/[\\+\-!(){}[\]^"~*?:/&|<>=]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120); }
  function euSearchUrl(o) {
    o = o || {};
    var f = normFilter(o.f), oi = o.src === "oi";
    var w = euWords(o.q) || "*";
    var query = oi ? w : w + " NOT DATA_PROVIDER:\"" + OI_PROVIDER + "\"";
    var p = "wskey=" + encodeURIComponent(str(o.key).trim()) + "&query=" + encodeURIComponent(query) +
      "&qf=" + encodeURIComponent("TYPE:VIDEO") + "&qf=" + encodeURIComponent("MIME_TYPE:video/mp4") + "&qf=" + encodeURIComponent("MIME_TYPE:video/ogg") +
      "&reusability=open&media=true&profile=rich&rows=" + PAGE + "&start=" + ((Math.max(1, Math.floor(+o.page || 1)) - 1) * PAGE + 1);
    if (oi) p += "&qf=" + encodeURIComponent("DATA_PROVIDER:\"" + OI_PROVIDER + "\"");
    if (f.c && EU_COUNTRY[f.c]) p += "&qf=" + encodeURIComponent("COUNTRY:\"" + EU_COUNTRY[f.c] + "\"");
    if (f.l) p += "&qf=" + encodeURIComponent("LANGUAGE:" + f.l);
    if (f.dec) p += "&qf=" + encodeURIComponent("YEAR:[" + f.dec + " TO " + (f.dec + 9) + "]");
    if (f.sort === "new" || f.sort === "old") p += "&sort=" + encodeURIComponent("YEAR " + (f.sort === "new" ? "desc" : "asc"));
    return "https://api.europeana.eu/record/v2/search.json?" + p;
  }
  // Licence names the app shows for the rights statements reusability=open returns.
  function euLic(u) {
    u = str(u);
    if (/publicdomain\/mark/.test(u)) return "Public domain";
    if (/publicdomain\/zero/.test(u)) return "CC0";
    var m = /licenses\/(by(?:-sa)?)\/(\d\.\d)/.exec(u);
    return m ? "CC " + m[1].toUpperCase() + " " + m[2] : "";
  }
  function euId(id) { return typeof id === "string" && /^\/[A-Za-z0-9_\/.-]{3,190}$/.test(id) ? id : ""; }
  function euItem(x, src) {
    if (!x) return null;
    var id = euId(x.id);
    var u = https(str(x.edmIsShownBy).replace(/^http:\/\//i, "https://"));
    if (!id || !u || !/\.(mp4|m4v|ogv|ogg|webm)(\?|$)/i.test(u)) return null;
    var lic = "";
    arr(x.rights).some(function (r) { lic = euLic(r); return !!lic; });
    if (!lic) return null;
    var c = EU_COUNTRY_BACK[str(x.country).toLowerCase()];
    var langs = arr(x.language).map(str).filter(function (l) { return /^[a-z]{2,3}$/.test(l); });
    var prev = https(x.edmPreview);
    return item({
      k: src + ":" + id, t: clip(x.title, 200) || id, y: year(x.year), ty: "news",
      c: c ? [c] : [], l: langs, im: /^https:\/\/api\.europeana\.eu\/thumbnail\//.test(prev) ? prev : "",
      u: u, lic: lic, ok: 1, why: "open", by: clip(x.dataProvider, 120), dir: clip(x.dcCreator, 160),
      ds: clip(x.dcDescription, 600), pg: "https://www.europeana.eu/item" + id, sl: 0
    });
  }
  function euParseSearch(j, o) {
    if (!j || j.success === false) return { error: /key/i.test(str(j && j.error)) ? "key" : "http", items: [], more: false };
    var src = o && o.src === "oi" ? "oi" : "eu";
    var list = Array.isArray(j.items) ? j.items : [];
    var items = list.map(function (x) { return euItem(x, src); }).filter(Boolean);
    var total = typeof j.totalResults === "number" ? j.totalResults : items.length;
    var page = Math.max(1, Math.floor(+(o && o.page) || 1));
    return { items: items, total: total, more: list.length >= PAGE && page * PAGE < Math.min(total, 1000) };
  }
  // A title from Continue watching / Watchlist: its record gives the file again.
  function euRecordUrl(id, key) { return "https://api.europeana.eu/record/v2" + euId(id) + ".json?wskey=" + encodeURIComponent(str(key).trim()); }
  function euParseRecord(j) {
    var a = j && j.object && Array.isArray(j.object.aggregations) ? j.object.aggregations[0] : null;
    var u = a ? https(str(a.edmIsShownBy).replace(/^http:\/\//i, "https://")) : "";
    return u && /\.(mp4|m4v|ogv|ogg|webm)(\?|$)/i.test(u) ? { url: u } : null;
  }

  // pt  PeerTube, searched through Sepia Search (Framasoft's index of
  //     public instances): only videos with a Creative Commons licence
  //     or a public-domain dedication (ids 1–7), no lives, no NSFW. As
  //     with the Internet Archive, a licence is the uploader's word, so
  //     only instances that publish their own work count as checked
  //     (PT_OWN); the rest show behind the same switch, marked.
  var PT_LIC = [1, 2, 3, 4, 5, 6, 7];
  var PT_OWN = { "video.blender.org": 1, "framatube.org": 1 };
  var PT_CAT = { film: 2, news: 11, comedy: 9 };
  function ptHost(h) { return typeof h === "string" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) && h.length <= 100 ? h : ""; }
  function ptUuid(u) { return typeof u === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u) ? u : ""; }
  function ptSearchUrl(o) {
    o = o || {};
    var f = normFilter(o.f), page = Math.max(1, Math.floor(+o.page || 1));
    var p = "count=" + PAGE + "&start=" + (page - 1) * PAGE + "&nsfw=false&isLive=false";
    PT_LIC.forEach(function (n) { p += "&licenceOneOf=" + n; });
    var q = clip(o.q, 120);
    if (q) p += "&search=" + encodeURIComponent(q);
    if (f.l) p += "&languageOneOf=" + encodeURIComponent(f.l);
    if (f.len === "short") p += "&durationMax=2399";
    if (f.len === "long") p += "&durationMin=2400";
    var cat = f.g === "comedy" ? PT_CAT.comedy : f.ty === "news" ? PT_CAT.news : f.ty === "film" ? PT_CAT.film : 0;
    if (cat) p += "&categoryOneOf=" + cat;
    p += "&sort=" + (f.sort === "new" ? "-publishedAt" : f.sort === "old" ? "publishedAt" : q ? "-match" : "-views");
    return "https://sepiasearch.org/api/v1/search/videos?" + p;
  }
  var PT_DOC = { 6: 1, 13: 1, 14: 1, 15: 1, 16: 1 };
  function ptItem(x) {
    if (!x || x.isLive || x.nsfw) return null;
    var host = ptHost(x.account && x.account.host) || ptHost(str(x.url).replace(/^https:\/\/([^/]+)\/.*$/, "$1"));
    var uuid = ptUuid(x.uuid);
    var lic = x.licence && PT_LIC.indexOf(+x.licence.id) >= 0 ? clip(x.licence.label, 80) : "";
    if (!host || !uuid || !lic) return null;
    var cat = x.category ? +x.category.id : 0;
    var d = +x.duration > 0 ? Math.max(1, Math.round(+x.duration / 60)) : 0;
    var ty = cat === 11 ? "news" : PT_DOC[cat] ? "doc" : d > 0 && d < 40 ? "short" : "film";
    var own = !!PT_OWN[host];
    var im = https(x.thumbnailUrl || x.previewUrl);
    return item({
      k: "pt:" + host + "/" + uuid, t: clip(x.name, 200) || uuid, y: year(x.originallyPublishedAt || x.publishedAt), d: d, ty: ty,
      l: x.language && /^[a-z]{2,3}$/.test(str(x.language.id)) ? [x.language.id] : [],
      im: im, lic: lic, ok: own ? 1 : 0, why: own ? "pt" : "listed", by: clip((x.channel && x.channel.displayName) || (x.account && x.account.displayName), 120),
      ds: clip(stripHtml(x.description), 600), pg: https(x.url) || "https://" + host + "/w/" + uuid,
      sl: Math.max(0, Math.floor(+x.views || 0))
    });
  }
  function ptParseSearch(j, o) {
    o = o || {};
    var f = normFilter(o.f);
    var list = j && Array.isArray(j.data) ? j.data : [];
    var items = list.map(ptItem).filter(function (it) { return it && (f.all || it.ok) && lenOk(it, f.len); });
    var total = j && typeof j.total === "number" ? j.total : items.length;
    var page = Math.max(1, Math.floor(+o.page || 1));
    return { items: items, total: total, more: list.length >= PAGE && page * PAGE < Math.min(total, 1000) };
  }
  function ptSplit(k) {
    var m = /^pt:([^/]+)\/(.+)$/.exec(str(k));
    return m && ptHost(m[1]) && ptUuid(m[2]) ? { host: m[1], uuid: m[2] } : null;
  }
  function ptVideoUrl(k) { var p = ptSplit(k); return p ? "https://" + p.host + "/api/v1/videos/" + p.uuid : ""; }
  function ptCaptionsUrl(k) { var p = ptSplit(k); return p ? "https://" + p.host + "/api/v1/videos/" + p.uuid + "/captions" : ""; }
  // -> { url, hls? } | null: a web-video file closest to 720 lines that
  // this browser plays, else the HLS playlist (Television's hls.js).
  function ptParseVideo(j, k, canPlay) {
    var p = ptSplit(k);
    if (!p || !j || typeof j !== "object") return null;
    var can = typeof canPlay === "function" ? canPlay : function () { return "maybe"; };
    var host = "https://" + p.host + "/";
    var files = (Array.isArray(j.files) ? j.files : []).map(function (f) {
      var u = https(f && (f.fileUrl || f.fileDownloadUrl));
      return u && u.indexOf(host) === 0 ? { url: u, h: f.resolution ? +f.resolution.id || 0 : 0 } : null;
    }).filter(function (f) { return f && f.h > 0 && can("video/mp4"); });
    if (files.length) {
      files.sort(function (a, b) { return Math.abs(720 - a.h) - Math.abs(720 - b.h) || a.h - b.h; });
      return { url: files[0].url };
    }
    var hls = "";
    (Array.isArray(j.streamingPlaylists) ? j.streamingPlaylists : []).some(function (pl) {
      var u = https(pl && pl.playlistUrl);
      if (u && u.indexOf(host) === 0 && /\.m3u8(\?|$)/.test(u)) { hls = u; return true; }
      return false;
    });
    return hls ? { url: hls, hls: 1 } : null;
  }
  function ptParseCaptions(j, k) {
    var p = ptSplit(k);
    if (!p) return [];
    return (j && Array.isArray(j.data) ? j.data : []).map(function (c) {
      var path = str(c && (c.captionPath || c.fileUrl));
      var url = /^https:\/\//.test(path) ? https(path) : /^\/[A-Za-z0-9_\/.-]+\.vtt$/.test(path) ? "https://" + p.host + path : "";
      var l = c && c.language ? str(c.language.id) : "";
      return url && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l) ? { l: l, url: url, label: clip(c.language.label, 40) } : null;
    }).filter(Boolean).slice(0, 30);
  }

  // ---------- 9. Subtitles (TV-VOD2) ----------
  // Commons keeps them as TimedText pages ("File.webm.<lang>.srt"); the
  // timedtext API returns any of them as WebVTT with CORS. The Internet
  // Archive and NASA keep .srt / .vtt files next to the video
  // (converted here); PeerTube gives WebVTT. Shown as text cues only.
  function commonsSubsUrl(file) {
    return "https://commons.wikimedia.org/w/api.php?" + qs({
      action: "query", format: "json", formatversion: "2", origin: "*", list: "allpages",
      apnamespace: "102", apprefix: str(file).replace(/ /g, "_"), aplimit: "60"
    });
  }
  function commonsParseSubs(j, file) {
    var pages = j && j.query && Array.isArray(j.query.allpages) ? j.query.allpages : [];
    var pre = "TimedText:" + str(file).replace(/_/g, " ") + ".", seen = {};
    return pages.map(function (p) {
      var t = str(p && p.title).replace(/_/g, " ");
      if (t.indexOf(pre) !== 0) return null;
      var m = /^([a-z]{2,3}(-[a-z]{2,4})?)\.srt$/i.exec(t.slice(pre.length));
      if (!m || seen[m[1].toLowerCase()]) return null;
      seen[m[1].toLowerCase()] = 1;
      return { l: m[1].toLowerCase(), url: "https://commons.wikimedia.org/w/api.php?" + qs({
        action: "timedtext", title: "File:" + str(file), lang: m[1].toLowerCase(), trackformat: "vtt", origin: "*" }) };
    }).filter(Boolean);
  }
  // SubRip -> WebVTT (times "00:01:02,345" -> "00:01:02.345", cue numbers kept).
  function srtToVtt(text) {
    var t = str(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (/^WEBVTT/.test(t)) return t;
    return "WEBVTT\n\n" + t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").trim() + "\n";
  }
  // Language of an Internet Archive subtitle file: "film.el.srt",
  // "film_greek.srt"; "" when it does not say. ".asr." = made by speech
  // recognition (auto: 1).
  var SUB_NAMES = { english: "en", greek: "el", german: "de", french: "fr", spanish: "es", italian: "it", portuguese: "pt", russian: "ru", dutch: "nl" };
  function subLang(name) {
    var n = str(name).toLowerCase().replace(/\.(srt|vtt)$/, "");
    var m = /[._-]([a-z]{2,3})(-[a-z]{2,4})?$/.exec(n);
    if (m && (IA_LANG[m[1]] || /^(en|el|de|fr|es|it|pt|ru|nl|sv|da|pl|ja|zh|ko|ar|tr|fi|no|cs|hu|ro)$/.test(m[1])) && m[1] !== "asr") return m[1];
    var w = /([a-z]+)$/.exec(n);
    return w && SUB_NAMES[w[1]] ? SUB_NAMES[w[1]] : "";
  }

  var api = {
    PAGE: PAGE, TYPES: TYPES, GENRES: GENRE_IDS, SORTS: SORTS, IA_LANG: IA_LANG, WD_QUERIES: WD_QUERIES,
    ageLimit: ageLimit, minutes: minutes, fold: fold, normFilter: normFilter, filterSupport: filterSupport,
    iaSearchUrl: iaSearchUrl, iaParseSearch: iaParseSearch, iaItem: iaItem, iaMetaUrl: iaMetaUrl, iaParseMeta: iaParseMeta,
    wdQueryUrl: wdQueryUrl, parseTsv: parseTsv, wdBuild: wdBuild, wdFilter: wdFilter, titleIn: titleIn, filePath: filePath,
    commonsInfoUrl: commonsInfoUrl, commonsPick: commonsPick, stripHtml: stripHtml,
    SOURCES: SOURCES, filterMissing: filterMissing,
    naSearchUrl: naSearchUrl, naParseSearch: naParseSearch, naAssetUrl: naAssetUrl, naParseAsset: naParseAsset,
    euKeyOk: euKeyOk, euSearchUrl: euSearchUrl, euParseSearch: euParseSearch, euRecordUrl: euRecordUrl, euParseRecord: euParseRecord, euLic: euLic,
    EU_COUNTRY: EU_COUNTRY,
    ptSearchUrl: ptSearchUrl, ptParseSearch: ptParseSearch, ptVideoUrl: ptVideoUrl, ptCaptionsUrl: ptCaptionsUrl,
    ptParseVideo: ptParseVideo, ptParseCaptions: ptParseCaptions,
    commonsSubsUrl: commonsSubsUrl, commonsParseSubs: commonsParseSubs, srtToVtt: srtToVtt, subLang: subLang,
    savedList: savedList, saveSearch: saveSearch, dropSearch: dropSearch,
    item: item, normVod: normVod, mergeVod: mergeVod, watchOn: watchOn, setWatch: setWatch,
    resumeOf: resumeOf, setResume: setResume, dropResume: dropResume, continueList: continueList, watchList: watchList
  };
  root.orosTvVod = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
