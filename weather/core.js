// ============================================================
// orOS Weather — core (pure, no DOM)
// Loaded by the Weather app AND the shell (index.html: the official
// warnings notice). Node tests: tests/weather-core.test.js.
//   1. helpers (entities, name folding, times)
//   2. MeteoAlarm: country table, Atom feed parser, CAP parser,
//      active list, the city's area (saved or guessed)
//   3. rain in the next 2 hours (Open-Meteo minutely_15) + sentence
//   4. air quality + pollen (Open-Meteo Air Quality): hours, days
//   5. forecast models: list, the compare response
// Exposed as window.OrosWeatherCore; module.exports in Node.
// Never fetches, never touches storage.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Helpers ----------
  function str(v) { return v == null ? "" : String(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function decode(s) {
    s = str(s);
    var m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
    if (m) return m[1];
    s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (all, e) {
      if (e.charAt(0) === "#") {
        var n = e.charAt(1).toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(n) || n <= 0 || n > 0x10ffff) return "";
        try { return String.fromCodePoint(n); } catch (x) { return ""; }
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : all;
    });
  }
  function plain(s) {   // markup → one clean text (CAP text may carry tags)
    var TAG = /<\/?[a-z][^<>]*>/gi;
    s = str(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    s = s.replace(/<br\s*\/?>/gi, "\n").replace(TAG, " ");
    s = decode(s).replace(/<br\s*\/?>/gi, "\n").replace(TAG, " ");
    return s.replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")
      .replace(/ ([.,;:!?])/g, "$1").trim();
  }

  // Lenient tag reading: <x>, <cap:x>, attributes, CDATA. Enough for
  // the MeteoAlarm feeds; never builds a DOM, never runs anything.
  function tagRe(name, flags) {
    return new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?" + name + "\\s*>", flags || "i");
  }
  function tagText(xml, name) {
    var m = tagRe(name).exec(str(xml));
    return m ? plain(m[1]) : "";
  }
  function tagAll(xml, name) {
    var re = tagRe(name, "gi"), out = [], m, s = str(xml);
    while ((m = re.exec(s))) out.push(m[1]);
    return out;
  }
  function attrOf(tag, name) {
    var m = new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i").exec(str(tag));
    return m ? decode(m[2] != null ? m[2] : m[3]) : "";
  }
  function httpUrl(u) { u = str(u).trim(); return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : ""; }

  // Greek → Latin, for matching city names typed in Greek against the
  // transliterated areas of the feed ("Αττική" ~ "Attiki").
  var GR = { "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i",
             "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
             "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o" };
  var STOP = { and: 1, of: 1, the: 1, de: 1, del: 1, la: 1, le: 1, region: 1, regional: 1, unit: 1,
               islands: 1, island: 1, province: 1, county: 1, district: 1, kreis: 1, stadt: 1,
               landkreis: 1, municipality: 1, perifereia: 1, periphery: 1, nomos: 1, prefecture: 1 };
  function fold(s) {
    s = str(s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    s = s.replace(/[α-ως]/g, function (c) { return GR[c] || c; });
    s = s.replace(/ph/g, "f").replace(/th/g, "t").replace(/ch/g, "h").replace(/c/g, "k")
         .replace(/y/g, "i").replace(/w/g, "v").replace(/[^a-z0-9]+/g, " ")
         .replace(/([a-z])\1+/g, "$1");
    return s.trim();
  }
  function tokens(s) {
    return fold(s).split(" ").filter(function (w) { return w.length >= 4 && !STOP[w]; });
  }
  function tokMatch(a, b) {
    if (a === b) return true;
    var n = 0, lim = Math.min(a.length, b.length);
    while (n < lim && a.charAt(n) === b.charAt(n)) n++;
    return n >= 4 && n >= 0.6 * lim;
  }

  // "YYYY-MM-DDTHH:MM" (a city's wall clock) ↔ minutes, both read as UTC.
  function keyMin(k) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(str(k));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
  }
  function nowKey(nowMs, offSec) {
    var d = new Date(nowMs + (offSec || 0) * 1000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
           "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  // ---------- 2. MeteoAlarm ----------
  // Feed per country: https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<slug>
  // ISO 3166 code → slug. Members of EUMETNET MeteoAlarm.
  var COUNTRIES = {
    AT: "austria", BE: "belgium", BA: "bosnia-herzegovina", BG: "bulgaria", HR: "croatia",
    CY: "cyprus", CZ: "czechia", DK: "denmark", EE: "estonia", FI: "finland", FR: "france",
    DE: "germany", GR: "greece", HU: "hungary", IS: "iceland", IE: "ireland", IL: "israel",
    IT: "italy", LV: "latvia", LT: "lithuania", LU: "luxembourg", MT: "malta", MD: "moldova",
    ME: "montenegro", NL: "netherlands", MK: "republic-of-north-macedonia", NO: "norway",
    PL: "poland", PT: "portugal", RO: "romania", RS: "serbia", SK: "slovakia", SI: "slovenia",
    ES: "spain", SE: "sweden", CH: "switzerland", GB: "united-kingdom", UA: "ukraine"
  };
  // A city without a country code (an old city, "My location"):
  // Open-Meteo's answer names its time zone; the zone names the country.
  var ZONES = {
    "Europe/Vienna": "AT", "Europe/Brussels": "BE", "Europe/Sarajevo": "BA", "Europe/Sofia": "BG",
    "Europe/Zagreb": "HR", "Asia/Nicosia": "CY", "Asia/Famagusta": "CY", "Europe/Nicosia": "CY",
    "Europe/Prague": "CZ", "Europe/Copenhagen": "DK", "Europe/Tallinn": "EE", "Europe/Helsinki": "FI",
    "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Busingen": "DE", "Europe/Athens": "GR",
    "Europe/Budapest": "HU", "Atlantic/Reykjavik": "IS", "Europe/Dublin": "IE", "Asia/Jerusalem": "IL",
    "Asia/Tel_Aviv": "IL", "Europe/Rome": "IT", "Europe/Riga": "LV", "Europe/Vilnius": "LT",
    "Europe/Luxembourg": "LU", "Europe/Malta": "MT", "Europe/Chisinau": "MD", "Europe/Podgorica": "ME",
    "Europe/Amsterdam": "NL", "Europe/Skopje": "MK", "Europe/Oslo": "NO", "Europe/Warsaw": "PL",
    "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT", "Europe/Bucharest": "RO",
    "Europe/Belgrade": "RS", "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI", "Europe/Madrid": "ES",
    "Atlantic/Canary": "ES", "Africa/Ceuta": "ES", "Europe/Stockholm": "SE", "Europe/Zurich": "CH",
    "Europe/London": "GB", "Europe/Belfast": "GB", "Europe/Kyiv": "UA", "Europe/Kiev": "UA"
  };
  var FEED_BASE = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-";
  function countryOf(cc, tzName) {
    var c = str(cc).toUpperCase();
    if (COUNTRIES[c]) return c;
    return ZONES[str(tzName)] || "";
  }
  function slugFor(cc, tzName) { var c = countryOf(cc, tzName); return c ? COUNTRIES[c] : ""; }
  function feedUrl(slug) {
    return /^[a-z-]{3,40}$/.test(str(slug)) ? FEED_BASE + slug : "";
  }

  // Awareness types (MeteoAlarm codes) → our kind ids.
  var TYPES = { 1: "wind", 2: "snow", 3: "storm", 4: "fog", 5: "heat", 6: "cold", 7: "coast",
                8: "fire", 9: "avalanche", 10: "rain", 12: "flood", 13: "flood" };
  var KIND_WORDS = [
    ["avalanche", /avalan|lavin/], ["fire", /fire|forest|incend|feu/],
    ["flood", /flood|inond|hochwasser/], ["storm", /thunder|storm|orage|gewitter/],
    ["snow", /snow|ice|icing|frost|neige|verglas|glatt/], ["fog", /fog|brouillard|nebel/],
    ["heat", /high.?temp|heat|canicul|hitze/], ["cold", /low.?temp|cold|grand froid|kalte|kälte/],
    ["coast", /coast|tide|wave|surge|marine|cotier/], ["wind", /wind|vent|gale/],
    ["rain", /rain|pluie|regen|precip/]
  ];
  function kindOf(text, typeParam) {
    var n = parseInt(str(typeParam), 10);
    if (TYPES[n]) return TYPES[n];
    var t = str(text).toLowerCase();
    for (var i = 0; i < KIND_WORDS.length; i++) if (KIND_WORDS[i][1].test(t)) return KIND_WORDS[i][0];
    return "other";
  }
  // Awareness level 1 green … 4 red: the CAP parameter first, then the
  // CAP severity, then a colour word in the title.
  var SEV = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
  function levelOf(levelParam, severity, text) {
    var n = parseInt(str(levelParam), 10);
    if (n >= 1 && n <= 4) return n;
    var lp = str(levelParam).toLowerCase();
    if (/red/.test(lp)) return 4;
    if (/orange/.test(lp)) return 3;
    if (/yellow/.test(lp)) return 2;
    var s = SEV[str(severity).trim().toLowerCase()];
    if (s) return s;
    var t = str(text).toLowerCase();
    if (/\bred\b/.test(t)) return 4;
    if (/\borange\b/.test(t)) return 3;
    if (/\byellow\b/.test(t)) return 2;
    if (/\bgreen\b/.test(t)) return 1;
    return 0;
  }
  // CAP parameters, inline (<cap:parameter><valueName>…) or as tags.
  function params(xml) {
    var out = {};
    tagAll(xml, "parameter").forEach(function (p) {
      var k = tagText(p, "valueName").toLowerCase(), v = tagText(p, "value");
      if (k && !out[k]) out[k] = v;
    });
    ["awareness_level", "awareness_type"].forEach(function (k) {
      if (!out[k]) { var v = tagText(xml, k); if (v) out[k] = v; }
    });
    return out;
  }
  function geocodes(xml) {
    var out = [];
    tagAll(xml, "geocode").forEach(function (g) {
      var v = tagText(g, "value");
      if (v && out.indexOf(v) < 0 && out.length < 20) out.push(v.slice(0, 40));
    });
    return out;
  }
  function timeMs(s) { var t = Date.parse(str(s).trim()); return isFinite(t) ? t : null; }

  // The Atom feed → [{ id, area, geo[], event, kind, level, sev, urg,
  //   cert, onset, exp, sent, status, msg, cap, web, title }]
  function parseAtom(text) {
    var s = str(text), out = [];
    if (!/<feed[\s>]/i.test(s) && !/<entry[\s>]/i.test(s)) return null;
    var re = /<entry[\s>][\s\S]*?<\/entry\s*>/gi, m;
    while ((m = re.exec(s)) && out.length < 1000) {
      var e = m[0], links = e.match(/<link\b[^>]*>/gi) || [], cap = "", web = "";
      links.forEach(function (l) {
        var href = httpUrl(attrOf(l, "href")), type = attrOf(l, "type").toLowerCase(), rel = attrOf(l, "rel").toLowerCase();
        if (!href) return;
        if (/cap/.test(type) || (!cap && !rel && /\/api\/|\.xml/i.test(href))) cap = cap || href;
        else if (!web && (rel === "alternate" || !rel)) web = href;
      });
      var pr = params(e), title = tagText(e, "title"), event = tagText(e, "event");
      var id = tagText(e, "identifier") || tagText(e, "id") || (cap || title);
      out.push({
        id: id.slice(0, 200),
        area: tagText(e, "areaDesc").slice(0, 160),
        geo: geocodes(e),
        event: event.slice(0, 160),
        kind: kindOf(event + " " + title, pr.awareness_type),
        level: levelOf(pr.awareness_level, tagText(e, "severity"), title + " " + event),
        sev: tagText(e, "severity"),
        urg: tagText(e, "urgency"),
        cert: tagText(e, "certainty"),
        onset: timeMs(tagText(e, "onset") || tagText(e, "effective")),
        exp: timeMs(tagText(e, "expires")),
        sent: timeMs(tagText(e, "sent") || tagText(e, "updated")),
        status: tagText(e, "status"),
        msg: tagText(e, "message_type") || tagText(e, "msgType"),
        cap: cap, web: web,
        title: title.slice(0, 200)
      });
    }
    return out;
  }

  // A CAP alert (the entry's link) → the details in the best language.
  function parseCap(text, lang) {
    var s = str(text);
    if (!/<alert[\s>]/i.test(s)) return null;
    var infos = tagAll(s, "info");
    if (!infos.length) return null;
    var want = lang === "el" ? "el" : "en";
    function langOf(i) { return tagText(i, "language").toLowerCase(); }
    var pick = null;
    infos.forEach(function (i) { if (!pick && langOf(i).indexOf(want) === 0) pick = i; });
    infos.forEach(function (i) { if (!pick && langOf(i).indexOf("en") === 0) pick = i; });
    pick = pick || infos[0];
    var pr = params(pick);
    return {
      lang: langOf(pick),
      event: tagText(pick, "event").slice(0, 200),
      headline: tagText(pick, "headline").slice(0, 300),
      desc: tagText(pick, "description").slice(0, 3000),
      instr: tagText(pick, "instruction").slice(0, 3000),
      sender: tagText(pick, "senderName").slice(0, 200),
      web: httpUrl(tagText(pick, "web")),
      level: levelOf(pr.awareness_level, tagText(pick, "severity"), ""),
      kind: kindOf(tagText(pick, "event"), pr.awareness_type),
      onset: timeMs(tagText(pick, "onset") || tagText(pick, "effective")),
      exp: timeMs(tagText(pick, "expires"))
    };
  }

  // Warnings in force (or coming): real, not cancelled, not expired,
  // yellow or above; one per identifier; worst first, then soonest.
  function activeList(list, nowMs) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (w) {
      if (!w || typeof w !== "object") return;
      if (w.status && !/^actual$/i.test(w.status)) return;
      if (/cancel/i.test(w.msg || "")) return;
      if (!(w.level >= 2)) return;
      if (typeof w.exp === "number" && w.exp <= nowMs) return;
      var k = w.id + "|" + w.area;
      if (seen[k]) return;
      seen[k] = 1;
      out.push(w);
    });
    out.sort(function (a, b) {
      if (a.level !== b.level) return b.level - a.level;
      return (a.onset || 0) - (b.onset || 0);
    });
    return out;
  }

  // Which of the country's warnings are the city's own.
  //   city: { label, adm, wa: { n, g } }   wa = the area the user picked
  // → { mine: [], others: [], area: name | "", how: "saved" | "guess" | "" }
  function forCity(list, city) {
    city = city || {};
    var mine = [], others = [], area = "", how = "";
    var wa = city.wa && typeof city.wa === "object" ? city.wa : null;
    if (wa && (wa.n || wa.g)) {
      how = "saved"; area = str(wa.n);
      list.forEach(function (w) {
        var hit = (wa.g && w.geo && w.geo.indexOf(wa.g) >= 0) || (wa.n && fold(w.area) === fold(wa.n));
        (hit ? mine : others).push(w);
      });
      return { mine: mine, others: others, area: area, how: how };
    }
    var ct = tokens(str(city.adm) + " " + str(city.label));
    var best = 0, bestAreas = {}, scores = {};
    list.forEach(function (w) {
      var key = fold(w.area);
      if (scores[key] !== undefined) return;
      var at = tokens(w.area), sc = 0;
      ct.forEach(function (x) { if (at.some(function (y) { return tokMatch(x, y); })) sc++; });
      if (fold(w.area) && fold(w.area) === fold(city.label)) sc += 2;
      scores[key] = sc;
      if (sc > best) { best = sc; bestAreas = {}; bestAreas[key] = w.area; }
      else if (sc === best && sc > 0) bestAreas[key] = w.area;
    });
    var keys = Object.keys(bestAreas);
    if (best > 0 && keys.length === 1) { area = bestAreas[keys[0]]; how = "guess"; }
    list.forEach(function (w) { (how && fold(w.area) === keys[0] ? mine : others).push(w); });
    return { mine: mine, others: others, area: area, how: how };
  }

  // Area names of the country's list, once each, sorted (for "My area").
  function areas(list) {
    var seen = {}, out = [];
    list.forEach(function (w) {
      var k = fold(w.area);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push({ n: w.area, g: (w.geo && w.geo[0]) || "" });
    });
    out.sort(function (a, b) { return a.n < b.n ? -1 : (a.n > b.n ? 1 : 0); });
    return out;
  }

  var LEVEL_WORD = {
    en: { 2: "Yellow", 3: "Orange", 4: "Red" },
    el: { 2: "Κίτρινη", 3: "Πορτοκαλί", 4: "Κόκκινη" }
  };
  var KIND_WORD = {
    en: { wind: "wind", snow: "snow or ice", storm: "thunderstorms", fog: "fog", heat: "high temperatures",
          cold: "low temperatures", coast: "coastal event", fire: "forest fire risk", avalanche: "avalanches",
          rain: "rain", flood: "flooding", other: "weather" },
    el: { wind: "άνεμοι", snow: "χιόνι ή πάγος", storm: "καταιγίδες", fog: "ομίχλη", heat: "υψηλές θερμοκρασίες",
          cold: "χαμηλές θερμοκρασίες", coast: "παράκτια φαινόμενα", fire: "κίνδυνος πυρκαγιάς", avalanche: "χιονοστιβάδες",
          rain: "βροχή", flood: "πλημμύρες", other: "καιρός" }
  };
  // "Orange warning: thunderstorms" / "Πορτοκαλί προειδοποίηση: καταιγίδες"
  function warnTitle(w, lang) {
    var L = lang === "el" ? "el" : "en";
    var lv = LEVEL_WORD[L][w.level] || LEVEL_WORD[L][2];
    var k = KIND_WORD[L][w.kind] || KIND_WORD[L].other;
    return lv + (L === "el" ? " προειδοποίηση: " : " warning: ") + k;
  }

  // ---------- 3. Rain in the next two hours ----------
  // Open-Meteo minutely_15 → [{ t: "YYYY-MM-DDTHH:MM", p: mm, s: cm }]
  // from the slot that holds "now" (city clock), at most n slots.
  function minutelySlots(d, nowK, n) {
    var m = d && d.minutely_15;
    if (!m || !Array.isArray(m.time)) return null;
    var pr = m.precipitation, sn = m.snowfall, now = keyMin(nowK), out = [];
    if (!Array.isArray(pr) || now === null) return null;
    for (var i = 0; i < m.time.length && out.length < (n || 9); i++) {
      var t = keyMin(m.time[i]);
      if (t === null || t + 15 <= now) continue;
      var p = num(pr[i]);
      if (p === null) { if (out.length) break; continue; }
      out.push({ t: str(m.time[i]).slice(0, 16), p: p, s: Array.isArray(sn) ? (num(sn[i]) || 0) : 0 });
    }
    return out.length ? out : null;
  }

  var WET = 0.1;   // mm in 15 minutes: below this the slot counts as dry
  // → { state: "dry" | "start" | "stop" | "all", min, rate: "light" | "moderate" | "heavy", snow }
  // "min" counts from now to the slot's start (start) or end (stop).
  function nowcast(slots, nowK, horizonMin) {
    var now = keyMin(nowK), hz = horizonMin || 120;
    if (!Array.isArray(slots) || !slots.length || now === null) return null;
    var list = slots.filter(function (x) { var t = keyMin(x.t); return t !== null && t + 15 > now && t < now + hz; });
    if (!list.length) return null;
    var wet = list.map(function (x) { return x.p >= WET; });
    var peak = 0, snow = false;
    list.forEach(function (x, i) { if (wet[i]) { if (x.p > peak) peak = x.p; if (x.s > 0) snow = true; } });
    var perHour = peak * 4;
    var rate = perHour >= 7.6 ? "heavy" : (perHour >= 2.5 ? "moderate" : "light");
    function minsTo(t) { return Math.max(0, keyMin(t) - now); }
    var i;
    if (wet[0]) {
      for (i = 1; i < list.length; i++) if (!wet[i]) return { state: "stop", min: minsTo(list[i].t), rate: rate, snow: snow };
      return { state: "all", min: 0, rate: rate, snow: snow };
    }
    for (i = 1; i < list.length; i++) if (wet[i]) return { state: "start", min: minsTo(list[i].t), rate: rate, snow: snow };
    return { state: "dry", min: 0, rate: "", snow: false };
  }

  function roundMin(m) {   // ~5-minute steps, never "in 0 min"
    return Math.max(5, Math.round(m / 5) * 5);
  }
  function durText(m, L) {
    m = roundMin(m);
    if (m < 60) return m + " " + (L === "el" ? "λεπτά" : "min");
    var h = Math.floor(m / 60), r = m % 60;
    if (L === "el") return h + (h === 1 ? " ώρα" : " ώρες") + (r ? " " + r + " λεπτά" : "");
    return h + (h === 1 ? " hour" : " hours") + (r ? " " + r + " min" : "");
  }
  var RATE = {
    en: { light: "Light ", moderate: "", heavy: "Heavy " },
    el: { light: "Ασθενής ", moderate: "", heavy: "Έντονη " }
  };
  // One sentence: "Rain starts in ~30 min", "Light rain stops in ~45 min",
  // "Rain for the next 2 hours", "No rain in the next 2 hours".
  function nowcastText(nc, lang, horizonMin) {
    var L = lang === "el" ? "el" : "en", hz = durText(horizonMin || 120, L);
    if (!nc) return "";
    if (nc.state === "dry") return L === "el" ? "Χωρίς βροχή τις επόμενες " + hz : "No rain in the next " + hz;
    var what;
    if (L === "el") {
      if (nc.state === "stop") return (nc.snow ? "Το χιόνι" : "Η βροχή") + " σταματά σε ~" + durText(nc.min, L);
      what = nc.snow ? "Χιόνι" : (RATE.el[nc.rate] || "") + (nc.rate && nc.rate !== "moderate" ? "βροχή" : "Βροχή");
      if (nc.state === "all") return what + " όλες τις επόμενες " + hz;
      return what + " σε ~" + durText(nc.min, L);
    }
    what = nc.snow ? "Snow" : (RATE.en[nc.rate] || "") + (nc.rate && nc.rate !== "moderate" ? "rain" : "Rain");
    if (nc.state === "all") return what + " for the next " + hz;
    return what + (nc.state === "start" ? " starts in ~" : " stops in ~") + durText(nc.min, L);
  }

  // ---------- 4. Air quality + pollen ----------
  var POLLEN = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"];
  var AIR_VARS = ["european_aqi", "european_aqi_pm2_5", "european_aqi_pm10", "european_aqi_nitrogen_dioxide",
                  "european_aqi_ozone", "pm2_5", "pm10", "ozone", "nitrogen_dioxide"]
                 .concat(POLLEN.map(function (p) { return p + "_pollen"; }));
  // Air Quality API answer → hours from now (city clock), at most n.
  // { t, a (EAQI), s: {pm25, pm10, no2, o3} sub-indices, c: {…} µg/m³, pol: {type: grains/m³} }
  function airHours(d, nowHourK, n) {
    var h = d && d.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    var out = [], start = str(nowHourK).slice(0, 13) + ":00";
    function v(name, i) { return Array.isArray(h[name]) ? num(h[name][i]) : null; }
    for (var i = 0; i < h.time.length && out.length < (n || 72); i++) {
      if (str(h.time[i]) < start) continue;
      var row = { t: str(h.time[i]).slice(0, 16), a: v("european_aqi", i),
        s: { pm25: v("european_aqi_pm2_5", i), pm10: v("european_aqi_pm10", i),
             no2: v("european_aqi_nitrogen_dioxide", i), o3: v("european_aqi_ozone", i) },
        c: { pm25: v("pm2_5", i), pm10: v("pm10", i), no2: v("nitrogen_dioxide", i), o3: v("ozone", i) },
        pol: {} };
      POLLEN.forEach(function (p) { var x = v(p + "_pollen", i); if (x !== null) row.pol[p] = x; });
      out.push(row);
    }
    return out.length ? out : null;
  }

  function aqiLevel(v) {
    if (v <= 20) return "good";
    if (v <= 40) return "fair";
    if (v <= 60) return "moderate";
    if (v <= 80) return "poor";
    if (v <= 100) return "vpoor";
    return "epoor";
  }
  // Pollen grains/m³ → 0 none, 1 low, 2 moderate, 3 high, 4 very high
  // (US NAB count scale: trees, grasses, weeds).
  var POL_CUT = { tree: [1, 15, 90, 1500], grass: [1, 5, 20, 200], weed: [1, 10, 50, 500] };
  var POL_GROUP = { alder: "tree", birch: "tree", olive: "tree", grass: "grass", mugwort: "weed", ragweed: "weed" };
  function pollenLevel(type, v) {
    var c = POL_CUT[POL_GROUP[type] || "tree"];
    if (!(v >= c[0])) return 0;
    if (v < c[1]) return 1;
    if (v < c[2]) return 2;
    if (v < c[3]) return 3;
    return 4;
  }
  function dominant(s) {
    var best = "", bv = -1;
    ["pm25", "pm10", "no2", "o3"].forEach(function (k) { if (s && s[k] !== null && s[k] > bv) { bv = s[k]; best = k; } });
    return best;
  }
  // One line per day: worst AQI (its hour and main pollutant), the
  // strongest pollen of each type.
  function airDays(hours) {
    var days = [], by = {};
    (hours || []).forEach(function (r) {
      var day = r.t.slice(0, 10), d = by[day];
      if (!d) { d = by[day] = { date: day, max: null, at: "", main: "", pol: {} }; days.push(d); }
      if (r.a !== null && (d.max === null || r.a > d.max)) { d.max = r.a; d.at = r.t.slice(11, 16); d.main = dominant(r.s); }
      Object.keys(r.pol || {}).forEach(function (p) { if (d.pol[p] === undefined || r.pol[p] > d.pol[p]) d.pol[p] = r.pol[p]; });
    });
    days.forEach(function (d) {
      d.level = d.max === null ? "" : aqiLevel(d.max);
      d.pollen = Object.keys(d.pol).map(function (p) { return { type: p, v: d.pol[p], lvl: pollenLevel(p, d.pol[p]) }; })
        .filter(function (x) { return x.lvl > 0; })
        .sort(function (a, b) { return b.lvl - a.lvl || b.v - a.v || (a.type < b.type ? -1 : 1); });
    });
    return days;
  }

  // ---------- 5. Forecast models ----------
  var MODELS = [
    { id: "best_match", n: "" },
    { id: "ecmwf_ifs025", n: "ECMWF IFS" },
    { id: "icon_seamless", n: "DWD ICON" },
    { id: "gfs_seamless", n: "NOAA GFS" },
    { id: "meteofrance_seamless", n: "Météo-France" },
    { id: "ukmo_seamless", n: "UK Met Office" },
    { id: "metno_seamless", n: "MET Norway" },
    { id: "gem_seamless", n: "GEM (Canada)" },
    { id: "jma_seamless", n: "JMA (Japan)" }
  ];
  function okModel(id) { return MODELS.some(function (m) { return m.id === id; }); }

  // Several models in one answer: daily keys carry a _<model> suffix
  // (one model alone: no suffix). → { dates, series: [{ model, max, min, rain }] }
  function parseCompare(d, models) {
    var dl = d && d.daily;
    if (!dl || !Array.isArray(dl.time)) return null;
    var one = models.length === 1, series = [];
    function col(name, m) {
      var a = dl[name + "_" + m];
      if (!Array.isArray(a) && one) a = dl[name];
      return Array.isArray(a) ? dl.time.map(function (x, i) { return num(a[i]); }) : null;
    }
    models.forEach(function (m) {
      var mx = col("temperature_2m_max", m), mn = col("temperature_2m_min", m), rn = col("precipitation_sum", m);
      if (!mx && !mn) return;
      var empty = function (a) { return !a || a.every(function (x) { return x === null; }); };
      if (empty(mx) && empty(mn)) return;
      series.push({ model: m, max: mx || [], min: mn || [], rain: rn || [] });
    });
    return series.length ? { dates: dl.time.map(str), series: series } : null;
  }

  var api = {
    decode: decode, plain: plain, tagText: tagText, fold: fold, tokens: tokens, keyMin: keyMin, nowKey: nowKey,
    COUNTRIES: COUNTRIES, ZONES: ZONES, countryOf: countryOf, slugFor: slugFor, feedUrl: feedUrl,
    kindOf: kindOf, levelOf: levelOf, parseAtom: parseAtom, parseCap: parseCap, activeList: activeList,
    forCity: forCity, areas: areas, warnTitle: warnTitle,
    minutelySlots: minutelySlots, nowcast: nowcast, nowcastText: nowcastText, WET: WET,
    POLLEN: POLLEN, AIR_VARS: AIR_VARS, airHours: airHours, airDays: airDays, aqiLevel: aqiLevel,
    pollenLevel: pollenLevel, dominant: dominant,
    MODELS: MODELS, okModel: okModel, parseCompare: parseCompare
  };
  root.OrosWeatherCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
