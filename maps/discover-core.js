// ============================================================
// orOS Maps — discover-core.js (Discover, maps wave 11, v1.0.0)
//
// Pure logic, no DOM (tests/maps-discover.test.js):
//   - Opening hours: a parser for the common part of the OSM
//     opening_hours syntax (24/7, weekday lists and ranges, several
//     time ranges, past midnight, off / closed, ";" and "," rules,
//     comments) and "open now / closes at / opens at". Anything it
//     can't read with certainty (months, dates, sunrise, PH-only
//     rules mixed with times it can't place) gives "unknown", never a
//     wrong "open".
//   - Nearby places: categories, the Overpass query around a point,
//     parsing and sorting by distance. Since wave H6 (hiking and
//     cycling, v1.1.0) also outdoor categories (water and springs,
//     shelters and huts, peaks and viewpoints, camping and picnic, bike
//     repair and parking) with the kind, the height, "drinking water"
//     yes / no / not known, seasonal and fee; a category may union
//     several Overpass filters (q as a list).
//   - Wikipedia geosearch URL + parsing, Panoramax search URL +
//     parsing. All three are free, keyless and CORS-open.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  var DAY_MIN = 1440;

  // ---------- opening hours ----------
  function dayIdx(s) { return DAYS.indexOf(s); }
  function hm(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 48 || mi > 59) return null;
    return h * 60 + mi;
  }
  // "Mo-Fr,Su" → [0,1,2,3,4,6]; null when it can't be read.
  function parseDays(sel) {
    var out = [];
    var parts = sel.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p === "PH" || p === "SH") continue;   // holidays: unknown dates, left out
      var r = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(p);
      if (!r) return null;
      var a = dayIdx(r[1]), b = r[2] ? dayIdx(r[2]) : a;
      for (var d = a, n = 0; n < 7; d = (d + 1) % 7, n++) {
        if (out.indexOf(d) < 0) out.push(d);
        if (d === b) break;
      }
    }
    return out;
  }
  // "08:00-12:00,13:00-17:30" → [[480,720],[780,1050]]; past midnight
  // ends > 1440. "10:00+" (open end) → till midnight.
  function parseTimes(s) {
    var out = [];
    var parts = s.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      var plus = /^(\d{1,2}:\d{2})\+$/.exec(p);
      if (plus) {
        var st = hm(plus[1]);
        if (st === null) return null;
        out.push([st, Math.max(st + 1, DAY_MIN)]);
        continue;
      }
      var r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\+?$/.exec(p);
      if (!r) return null;
      var a = hm(r[1]), b = hm(r[2]);
      if (a === null || b === null || a >= DAY_MIN) return null;
      if (b <= a) b += DAY_MIN;                 // 22:00-02:00
      out.push([a, b]);
    }
    return out;
  }

  // Returns a week { days: [[[s,e],...] x7] } or null (can't read it).
  function parseHours(str) {
    if (typeof str !== "string") return null;
    var s = str.replace(/\s+/g, " ").trim();
    if (!s || s.length > 600) return null;
    if (/^24\/7( open)?$/i.test(s)) {
      var all = [];
      for (var k = 0; k < 7; k++) all.push([[0, DAY_MIN]]);
      return { days: all, always: true };
    }
    // Comments go first (they may hold any character)
    s = s.replace(/"[^"]*"/g, " ").replace(/\s+/g, " ").trim();
    var days = [[], [], [], [], [], [], []];
    var rules = s.split(/\s*(?:;|\|\|)\s*/);
    var any = false;
    for (var i = 0; i < rules.length; i++) {
      if (!rules[i]) continue;
      // "Mo-Fr 08:00-12:00, Sa 10:00-12:00": the comma after a time
      // (or off) before a weekday starts an additional rule.
      var subs = rules[i].replace(/(\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/g, "$1\u0001").split("\u0001");
      for (var j = 0; j < subs.length; j++) {
        var res = applyRule(days, subs[j].trim(), j > 0);
        if (res === null) return null;
        if (res) any = true;
      }
    }
    if (!any) return null;
    return { days: days, always: false };
  }
  // true = applied, false = skipped (PH-only), null = can't read
  function applyRule(days, r, additional) {
    if (!r) return false;
    var m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)(?:\s+|$)(.*)$/.exec(r);
    var sel = m ? m[1] : "";
    var rest = (m ? m[2] : r).trim();
    var dlist;
    if (sel) {
      dlist = parseDays(sel);
      if (dlist === null) return null;
      if (!dlist.length) return false;           // "PH off": nothing we can place
    } else {
      dlist = [0, 1, 2, 3, 4, 5, 6];
    }
    var iv;
    if (/^(off|closed)$/i.test(rest)) iv = [];
    else if (rest === "" || /^open$/i.test(rest)) {
      if (!sel) return null;                     // an empty rule
      iv = [[0, DAY_MIN]];
    } else {
      iv = parseTimes(rest.replace(/\s+open$/i, ""));
      if (iv === null) return null;               // months, sunrise, week numbers…
    }
    dlist.forEach(function (d) {
      days[d] = additional && iv.length ? days[d].concat(iv) : iv.slice();
    });
    return true;
  }

  // Absolute minute ranges over 9 days starting the day BEFORE `date`
  // (so yesterday's past-midnight spill counts).
  function timeline(week, date) {
    var dw = (date.getDay() + 6) % 7, out = [];
    for (var off = -1; off <= 7; off++) {
      var d = ((dw + off) % 7 + 7) % 7;
      week.days[d].forEach(function (x) { out.push([off * DAY_MIN + x[0], off * DAY_MIN + x[1]]); });
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    out.forEach(function (x) {
      var last = merged[merged.length - 1];
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
      else merged.push([x[0], x[1]]);
    });
    return merged;
  }
  // { state: "open"|"closed"|"unknown", at: Date of the next change
  //   (null = none within a week) }
  function status(str, date) {
    var week = parseHours(str);
    if (!week) return { state: "unknown", at: null };
    var now = date.getHours() * 60 + date.getMinutes();
    var tl = timeline(week, date);
    var mid = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    function at(min) { var d = new Date(mid.getTime()); d.setMinutes(min); return d; }
    for (var i = 0; i < tl.length; i++) {
      if (tl[i][0] <= now && now < tl[i][1]) {
        return { state: "open", at: tl[i][1] >= 7 * DAY_MIN ? null : at(tl[i][1]) };
      }
    }
    for (var j = 0; j < tl.length; j++) {
      if (tl[j][0] > now) return { state: "closed", at: at(tl[j][0]) };
    }
    return { state: "closed", at: null };
  }

  // ---------- nearby places (Overpass) ----------
  var CATS = [
    { id: "restaurant", q: '["amenity"="restaurant"]', icon: "🍽" },
    { id: "cafe", q: '["amenity"="cafe"]', icon: "☕" },
    { id: "bar", q: '["amenity"~"^(bar|pub)$"]', icon: "🍸" },
    { id: "fast_food", q: '["amenity"="fast_food"]', icon: "🥙" },
    { id: "supermarket", q: '["shop"~"^(supermarket|convenience)$"]', icon: "🛒" },
    { id: "bakery", q: '["shop"~"^(bakery|pastry)$"]', icon: "🥐" },
    { id: "pharmacy", q: '["amenity"="pharmacy"]', icon: "💊" },
    { id: "atm", q: '["amenity"~"^(atm|bank)$"]', icon: "🏧" },
    { id: "fuel", q: '["amenity"~"^(fuel|charging_station)$"]', icon: "⛽" },
    { id: "toilets", q: '["amenity"="toilets"]', icon: "🚻" },
    { id: "museum", q: '["tourism"~"^(museum|gallery|attraction|viewpoint)$"]', icon: "🏛" },
    { id: "park", q: '["leisure"~"^(park|playground)$"]', icon: "🌳" },
    // wave H6: outdoors (out: no opening hours expected)
    { id: "water", out: 1, icon: "💧", q: ['["amenity"="drinking_water"]', '["natural"="spring"]', '["man_made"="water_tap"]', '["amenity"="water_point"]'] },
    { id: "shelter", out: 1, icon: "🛖", q: ['["amenity"="shelter"]', '["tourism"~"^(alpine_hut|wilderness_hut)$"]'] },
    { id: "peak", out: 1, icon: "⛰", q: ['["natural"~"^(peak|saddle|volcano)$"]', '["tourism"="viewpoint"]'] },
    { id: "camp", out: 1, icon: "⛺", q: ['["tourism"~"^(camp_site|picnic_site)$"]', '["leisure"~"^(picnic_table|firepit)$"]'] },
    { id: "bike", out: 1, icon: "🚲", q: ['["amenity"~"^(bicycle_repair_station|bicycle_rental|compressed_air)$"]', '["shop"="bicycle"]', '["amenity"="bicycle_parking"]["access"!~"^(private|customers)$"]'] }
  ];
  // the specific kind of an outdoor place (for its label)
  var KINDS = [
    ["natural", "spring"], ["amenity", "drinking_water"], ["man_made", "water_tap"], ["amenity", "water_point"],
    ["tourism", "alpine_hut"], ["tourism", "wilderness_hut"], ["amenity", "shelter"],
    ["natural", "peak"], ["natural", "volcano"], ["natural", "saddle"], ["tourism", "viewpoint"],
    ["tourism", "camp_site"], ["tourism", "picnic_site"], ["leisure", "picnic_table"], ["leisure", "firepit"],
    ["amenity", "bicycle_repair_station"], ["amenity", "bicycle_rental"], ["amenity", "compressed_air"], ["shop", "bicycle"], ["amenity", "bicycle_parking"]
  ];
  function kindOf(t) {
    for (var i = 0; i < KINDS.length; i++) if (t[KINDS[i][0]] === KINDS[i][1]) return KINDS[i][1];
    return "";
  }
  // "1120", "1120 m", "1,120.5" → metres, or null (feet are converted)
  function eleOf(s) {
    if (typeof s !== "string") return null;
    var m = /^\s*(-?\d{1,5}(?:[.,]\d+)?)\s*(m|ft|')?\s*$/i.exec(s.replace(/(\d),(\d{3})(?!\d)/, "$1$2"));
    if (!m) return null;
    var v = parseFloat(m[1].replace(",", "."));
    if (m[2] && /^(ft|')$/i.test(m[2])) v *= 0.3048;
    return v > -500 && v < 9000 ? Math.round(v) : null;
  }
  // drinking water: "yes" | "no" | "" (not known); a drinking_water
  // amenity is drinkable unless tagged otherwise
  function drinkOf(t, kind) {
    var d = t.drinking_water;
    if (d === "no" || d === "not_recommended" || t["drinking_water:legal"] === "no") return "no";
    if (d === "yes" || d === "treated" || d === "conditional") return "yes";
    if (kind === "drinking_water") return "yes";
    return "";
  }
  function catById(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return null;
  }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function nearbyQuery(catId, lat, lon, radius) {
    var c = catById(catId);
    if (!c || !isFinite(lat) || !isFinite(lon)) return "";
    var r = Math.max(100, Math.min(5000, Math.round(radius || 1500)));
    var around = "(around:" + r + "," + r6(lat) + "," + r6(lon) + ")";
    if (Array.isArray(c.q)) return "[out:json][timeout:20];(" + c.q.map(function (q) { return "nwr" + q + around + ";"; }).join("") + ");out tags center 200;";
    return "[out:json][timeout:20];nwr" + c.q + around + ";out tags center 200;";
  }
  function dist(a, b) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function clean(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max || 200) : "";
  }
  function parseNearby(json, catId, from, lang) {
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    var out = [], seen = {};
    els.forEach(function (e) {
      if (!e || !e.tags || (e.type !== "node" && e.type !== "way" && e.type !== "relation")) return;
      var lat = e.type === "node" ? e.lat : e.center && e.center.lat;
      var lon = e.type === "node" ? e.lon : e.center && e.center.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return;
      var id = e.type.charAt(0) + e.id;
      if (seen[id]) return;
      seen[id] = 1;
      var t = e.tags;
      var name = clean((lang && t["name:" + lang]) || t.name || t.brand || t.operator || "", 120);
      var site = clean(t.website || t["contact:website"] || "", 300);
      var kind = kindOf(t);
      out.push({
        kind: kind, ele: eleOf(t.ele), drink: drinkOf(t, kind),
        seasonal: t.seasonal && t.seasonal !== "no" ? 1 : 0, fee: t.fee === "yes" ? 1 : 0,
        id: id, cat: catId, lat: lat, lon: lon, name: name,
        hours: clean(t.opening_hours || "", 600),
        phone: clean(t.phone || t["contact:phone"] || "", 60),
        site: /^https?:\/\/[^\s"<>]+$/i.test(site) ? site : "",
        addr: clean([t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "), 120),
        d: from ? Math.round(dist(from, { lat: lat, lon: lon })) : 0
      });
    });
    out.sort(function (a, b) { return a.d - b.d || (a.id < b.id ? -1 : 1); });
    return out;
  }
  // Radius that covers the visible map, within limits
  function radiusFor(center, corner) {
    return Math.max(300, Math.min(5000, Math.round(dist(center, corner))));
  }

  // ---------- Wikipedia (MediaWiki geosearch) ----------
  // The app language's Wikipedia (el, de…); a language not listed asks English.
  var WIKI_LANGS = ["en", "el", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "tr", "sv", "cs", "ro", "hu",
    "fi", "da", "no", "bg", "sr", "hr", "sq", "ja", "zh", "ko", "ar", "he", "fa", "hi"];
  function wikiLang(lang) { return WIKI_LANGS.indexOf(lang) >= 0 ? lang : "en"; }
  function wikiUrl(lang, lat, lon, radius) {
    var l = wikiLang(lang);
    var r = Math.max(10, Math.min(10000, Math.round(radius || 5000)));
    return "https://" + l + ".wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*" +
      "&generator=geosearch&ggscoord=" + r6(lat) + "%7C" + r6(lon) + "&ggsradius=" + r + "&ggslimit=50" +
      "&prop=coordinates%7Cpageimages%7Cdescription&piprop=thumbnail&pithumbsize=160&pilimit=50";
  }
  function parseWiki(json, lang, from) {
    var pages = json && json.query && Array.isArray(json.query.pages) ? json.query.pages : [];
    var l = wikiLang(lang), out = [];
    pages.forEach(function (p) {
      if (!p || typeof p.title !== "string" || !Array.isArray(p.coordinates) || !p.coordinates[0]) return;
      var c = p.coordinates[0];
      if (typeof c.lat !== "number" || typeof c.lon !== "number") return;
      var th = p.thumbnail && typeof p.thumbnail.source === "string" &&
        /^https:\/\/upload\.wikimedia\.org\/[^\s"<>]+$/.test(p.thumbnail.source) ? p.thumbnail.source : "";
      out.push({
        id: "w" + (p.pageid || p.title), title: clean(p.title, 200), desc: clean(p.description || "", 200),
        lat: c.lat, lon: c.lon, thumb: th,
        url: "https://" + l + ".wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")),
        d: from ? Math.round(dist(from, { lat: c.lat, lon: c.lon })) : 0
      });
    });
    out.sort(function (a, b) { return a.d - b.d || (a.id < b.id ? -1 : 1); });
    return out;
  }

  // ---------- Panoramax (open street-level photos, STAC API) ----------
  var PANORAMAX = "https://api.panoramax.xyz";
  function photosUrl(s, w, n, e, limit) {
    function f(x) { return (Math.round(x * 1e5) / 1e5).toString(); }
    return PANORAMAX + "/api/search?bbox=" + [f(w), f(s), f(e), f(n)].join(",") + "&limit=" + Math.max(1, Math.min(200, limit || 100));
  }
  function safeImg(u) {
    return typeof u === "string" && /^https:\/\/[^\s"<>]+$/i.test(u) ? u : "";
  }
  function parsePhotos(json) {
    var fs = json && Array.isArray(json.features) ? json.features : [];
    var out = [], seen = {};
    fs.forEach(function (f) {
      if (!f || typeof f.id !== "string" || !/^[\w-]{1,80}$/.test(f.id) || seen[f.id]) return;
      var g = f.geometry && f.geometry.coordinates;
      if (!Array.isArray(g) || typeof g[0] !== "number" || typeof g[1] !== "number") return;
      var a = f.assets || {}, pr = f.properties || {};
      var thumb = safeImg(a.thumb && a.thumb.href), sd = safeImg(a.sd && a.sd.href) || thumb;
      if (!sd) return;
      seen[f.id] = 1;
      var az = typeof pr["view:azimuth"] === "number" ? pr["view:azimuth"] : null;
      out.push({
        id: f.id, lat: g[1], lon: g[0], thumb: thumb || sd, sd: sd, az: az,
        time: typeof pr.datetime === "string" && !isNaN(Date.parse(pr.datetime)) ? Date.parse(pr.datetime) : null,
        by: clean(pr["geovisio:producer"] || (Array.isArray(pr.providers) && pr.providers[0] && pr.providers[0].name) || "", 80),
        lic: clean(pr.license || "", 40),
        page: PANORAMAX + "/#focus=pic&pic=" + encodeURIComponent(f.id)
      });
    });
    return out;
  }

  var api = {
    VER: VER, DAYS: DAYS, CATS: CATS, PANORAMAX: PANORAMAX, eleOf: eleOf, kindOf: kindOf, drinkOf: drinkOf,
    parseHours: parseHours, status: status,
    catById: catById, nearbyQuery: nearbyQuery, parseNearby: parseNearby, dist: dist, radiusFor: radiusFor,
    wikiUrl: wikiUrl, parseWiki: parseWiki, photosUrl: photosUrl, parsePhotos: parsePhotos
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosMapsDiscover = api;
})(typeof window !== "undefined" ? window : null);
