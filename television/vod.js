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
  var MAX_WD = 8000;           // catalogue items kept
  var MAX_WATCH = 400;         // synced watchlist entries (removed ones included)
  var MAX_RESUME = 200;        // synced resume positions
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
    if (/^http:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|archive\.org|([a-z0-9-]+\.)*archive\.org)(\/|$)/i.test(s)) s = "https://" + s.slice(7);
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
    if (f.src === "wd" || f.src === "ia") o.src = f.src;
    if (f.all === 1 || f.all === true) o.all = 1;
    if (SORTS.indexOf(f.sort) > 0) o.sort = f.sort;
    return o;
  }
  // Which filters a source can apply. The Internet Archive knows no
  // country of production, so a country filter leaves it out.
  function filterSupport(src, f) {
    f = normFilter(f);
    if (src === "ia") return !f.c;
    return true;
  }
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
    return {
      parts: parts, closed: parts.length ? 0 : 1,
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
  function codes(a, re, n) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (x) { if (typeof x === "string" && re.test(x) && out.indexOf(x) < 0 && out.length < n) out.push(x); });
    return out;
  }
  function item(o) {
    if (!o || typeof o !== "object") return null;
    var k = str(o.k);
    if (!/^(wd:Q\d{1,12}|ia:[A-Za-z0-9][A-Za-z0-9._-]{0,99})$/.test(k)) return null;
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
    it.why = /^(commons|age|prelinger|listed)$/.test(str(o.why)) ? o.why : (it.ok ? "commons" : "listed");
    if (o.snd === "silent" || o.snd === "sound") it.snd = o.snd;
    if (o.col === "bw" || o.col === "color") it.col = o.col;
    return it;
  }

  // ---------- 7. Synced fields of the TELEVISION slice ----------
  // wl  watchlist     { <k>: { t, y?, im?, ty, w?, m, x? } }   x = removed
  // rp  resume points { <k>: { t, y?, im?, ty, w?, p, d, n?, m, f?, x? } }
  //      w = why an Internet Archive title is free (age | prelinger | listed).
  //      p = seconds watched, d = length in seconds, n = part (0 = first),
  //      f = finished.
  // Per-key last-writer-wins by m (tie: larger JSON), so the merge is
  // symmetric, idempotent and associative; a removal is an entry too
  // (x: 1), which keeps a removed title from coming back. Written only
  // when non-empty, keys sorted (old data loads unchanged).
  var KEY_RE = /^(wd:Q\d{1,12}|ia:[A-Za-z0-9][A-Za-z0-9._-]{0,99})$/;
  function entry(e, kind) {
    if (!e || typeof e !== "object") return null;
    var m = Math.floor(+e.m || 0);
    if (!(m > 0)) return null;
    var o = { m: m };
    if (e.x) { o.x = 1; return o; }
    o.t = clip(e.t, 200);
    var y = Math.floor(+e.y || 0); if (y >= YEAR_MIN && y <= 2100) o.y = y;
    var im = https(e.im); if (im) o.im = im;
    o.ty = TY_OK[e.ty] ? e.ty : "film";
    if (/^(age|prelinger|listed)$/.test(str(e.w))) o.w = e.w;
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
      Object.keys(src).forEach(function (k) {
        if (!KEY_RE.test(k)) return;
        var e = entry(src[k], kind);
        if (e) out[k] = e;
      });
    }
    out = capMap(out, cap);
    var sorted = {};
    Object.keys(out).sort().forEach(function (k) { sorted[k] = out[k]; });
    return sorted;
  }
  // In place: obj.wl / obj.rp canonical, absent when empty.
  function normVod(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var wl = normMap(obj.wl, "wl", MAX_WATCH), rp = normMap(obj.rp, "rp", MAX_RESUME);
    delete obj.wl; delete obj.rp;
    if (Object.keys(wl).length) obj.wl = wl;
    if (Object.keys(rp).length) obj.rp = rp;
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
    delete out.wl; delete out.rp;
    if (Object.keys(wl).length) out.wl = wl;
    if (Object.keys(rp).length) out.rp = rp;
    return out;
  }
  function stamp(prev, now) { return Math.max(Math.floor(+now || Date.now()), prev ? prev.m + 1 : 0); }
  function card(it) {
    var o = { t: it.t, ty: it.ty };
    if (it.y) o.y = it.y;
    if (it.im) o.im = it.im;
    if (it.s === "ia" && /^(age|prelinger|listed)$/.test(str(it.why))) o.w = it.why;
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

  var api = {
    PAGE: PAGE, TYPES: TYPES, GENRES: GENRE_IDS, SORTS: SORTS, IA_LANG: IA_LANG, WD_QUERIES: WD_QUERIES,
    ageLimit: ageLimit, minutes: minutes, fold: fold, normFilter: normFilter, filterSupport: filterSupport,
    iaSearchUrl: iaSearchUrl, iaParseSearch: iaParseSearch, iaItem: iaItem, iaMetaUrl: iaMetaUrl, iaParseMeta: iaParseMeta,
    wdQueryUrl: wdQueryUrl, parseTsv: parseTsv, wdBuild: wdBuild, wdFilter: wdFilter, titleIn: titleIn, filePath: filePath,
    commonsInfoUrl: commonsInfoUrl, commonsPick: commonsPick, stripHtml: stripHtml,
    item: item, normVod: normVod, mergeVod: mergeVod, watchOn: watchOn, setWatch: setWatch,
    resumeOf: resumeOf, setResume: setResume, dropResume: dropResume, continueList: continueList, watchList: watchList
  };
  root.orosTvVod = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
