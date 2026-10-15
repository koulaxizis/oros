// ============================================================
// orOS Travel — import.js (pure logic: trips from other apps)
// Reads a file the person exported from another travel app, as DATA
// only (nothing is run, nothing becomes HTML):
//   - Polarsteps  Account settings › "Download my data" (.zip):
//                 trip/<name>_<id>/trip.json { id, name, summary,
//                 start_date, end_date (unix s), timezone_id,
//                 all_steps: [{ id, name | display_name, description,
//                 start_time, timezone_id, location: { name, detail,
//                 lat, lon, country_code } }] } → a trip, one
//                 itinerary entry per step (with its map point) and
//                 the step texts as journal days. locations.json (the
//                 recorded track) and the photos are counted, not
//                 imported: Travel keeps no route of its own (tracks
//                 live in Maps). A bare trip.json works too.
//   - TripIt      the calendar feed (.ics, "Calendar feed" in TripIt's
//                 settings, or a downloaded file): the whole-trip
//                 all-day event becomes the trip, every other event
//                 an itinerary entry of the trip whose dates hold it:
//                 flights ("LH1234 ATH to MUC"), rail, hotels
//                 (check-in + check-out → one stay), car hire,
//                 restaurants, activities; anything unclear becomes
//                 an "Other" entry with its text as the note. A feed
//                 with several trips gives several trips.
// Times are the local time of the place, like the rest of Travel:
// Polarsteps times through the step's time zone (Intl), iCalendar
// TZID / floating times as written, UTC times in this device's zone.
//   read(name, bytes|text) → Promise<res|null>
//     res = { source: "polarsteps"|"tripit", trips: [T], skip: {
//             photos, points, outside, cancelled } }
//     T   = { id, name, dest, start, end, notes, entries: [{ id, kind,
//             title, day, t1, day2, t2, place, from, to, ref, num,
//             prov, note, geo }], jrnl: [{ day, text }], points }
//   plan(data, res) → [{ trip: T, cur (the trip already here or
//             null), add: [entries not here], jrnl: [days not here],
//             have (entries already here), over (no room) }]
// Stable ids: "imp-" + OrosImportKit.hash(source | the source's own
// id or UID), for trips and entries: importing again adds only what
// is missing and never changes what the person edited.
// Caps: file size, ZIP entries, events, steps, text lengths.
// Needs OrosImportKit (../importkit.js); ZIP needs AtelierZip.
// UMD: window.OrosTravelImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 60 * 1024 * 1024;      // the file as picked (photos make Polarsteps ZIPs big)
  var MAX_TEXT = 8 * 1024 * 1024;       // characters of one JSON / ICS read
  var MAX_TRIPS = 50;                   // trips per import
  var MAX_ENTRIES = 300;                // = the app's itinerary limit per trip
  var MAX_EVENTS = 3000;
  var MAX_ZIP_JSON = 120;
  var LEN = { name: 80, dest: 100, notes: 20000, title: 100, place: 150, stop: 60, ref: 60, num: 20, prov: 60, pnote: 1000, jtext: 5000 };
  var ACCEPT = ".zip,.json,.ics,application/zip,application/json,text/calendar";
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function line(v, n) { return K.clean(v, n); }
  function txt(v, n) { return K.cleanText(v, n); }
  function idOf(source, key) { return "imp-" + K.hash(source + "|" + key); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() && isFinite(+v) ? +v : NaN); }
  function geoOf(lat, lon) {
    lat = num(lat); lon = num(lon);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  }
  function localWall(ms) {
    var d = new Date(ms);
    return { day: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), hm: pad(d.getHours()) + ":" + pad(d.getMinutes()) };
  }
  // the wall-clock day and time of an instant in an IANA zone (or here)
  function wall(ms, tz) {
    if (!isFinite(ms)) return null;
    if (tz && typeof Intl !== "undefined") {
      try {
        var o = {};
        new Intl.DateTimeFormat("en-GB", { timeZone: String(tz), year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
        if (o.year && o.month && o.day) return { day: o.year + "-" + o.month + "-" + o.day, hm: (o.hour === "24" ? "00" : o.hour) + ":" + o.minute };
      } catch (e) {}
    }
    return localWall(ms);
  }
  function entry(o) {
    return {
      id: o.id, kind: o.kind || "other", title: line(o.title, LEN.title), day: o.day || "", t1: o.t1 || "",
      day2: o.day2 || "", t2: o.t2 || "", place: line(o.place, LEN.place), from: line(o.from, LEN.stop), to: line(o.to, LEN.stop),
      ref: line(o.ref, LEN.ref), num: line(o.num, LEN.num), prov: line(o.prov, LEN.prov), note: txt(o.note, LEN.pnote), geo: o.geo || null
    };
  }
  function span(t) {
    var days = [];
    t.entries.forEach(function (e) { if (e.day) days.push(e.day); if (e.day2) days.push(e.day2); });
    days.sort();
    if (!t.start && days.length) t.start = days[0];
    if (!t.end && days.length) t.end = days[days.length - 1];
    if (t.start && t.end && t.end < t.start) t.end = t.start;
    return t;
  }

  // ---------- 1. Polarsteps ----------
  function polarTrip(j, pointsN) {
    if (!j || typeof j !== "object" || !Array.isArray(j.all_steps)) return null;
    var tz = typeof j.timezone_id === "string" ? j.timezone_id : "";
    var key = j.id !== undefined && j.id !== null ? String(j.id) : line(j.name, 80) + "|" + j.start_date;
    var tid = idOf("polarsteps", key);
    var t = { id: tid, name: line(j.name || j.display_name, LEN.name), dest: "", start: "", end: "",
              notes: txt(j.summary, LEN.notes), entries: [], jrnl: [], points: pointsN || 0 };
    var s0 = num(j.start_date), s1 = num(j.end_date);
    if (isFinite(s0) && s0 > 0) t.start = wall(s0 * 1000, tz).day;
    if (isFinite(s1) && s1 > 0) t.end = wall(s1 * 1000, tz).day;
    var steps = j.all_steps.filter(function (s) { return s && typeof s === "object"; }).slice(0, 5000);
    steps.sort(function (a, b) { return (num(a.start_time) || 0) - (num(b.start_time) || 0); });
    var countries = [], byDay = {};
    steps.forEach(function (s, i) {
      var loc = s.location && typeof s.location === "object" ? s.location : {};
      var at = num(s.start_time);
      var w = isFinite(at) && at > 0 ? wall(at * 1000, s.timezone_id || tz) : null;
      var title = line(s.display_name || s.name || loc.name, LEN.title);
      var place = [line(loc.name, 100), line(loc.detail, 60)].filter(Boolean).join(", ");
      var country = line(loc.detail, 60) || line(loc.country_code, 8).toUpperCase();
      if (country && countries.indexOf(country) < 0) countries.push(country);
      if (t.entries.length < MAX_ENTRIES) {
        t.entries.push(entry({ id: idOf("polarsteps", key + "|" + (s.id !== undefined ? s.id : i)), kind: "activity",
          title: title || place, day: w ? w.day : "", t1: w ? w.hm : "", place: place, geo: geoOf(loc.lat, loc.lon) }));
      }
      var desc = txt(s.description, LEN.jtext);
      if (w && desc) (byDay[w.day] = byDay[w.day] || []).push((title ? title + "\n" : "") + desc);
    });
    Object.keys(byDay).sort().forEach(function (d) { t.jrnl.push({ day: d, text: txt(byDay[d].join("\n\n"), LEN.jtext) }); });
    t.dest = line(countries.slice(0, 3).join(", "), LEN.dest);
    if (!t.name) t.name = line(t.dest || "Polarsteps", LEN.name);
    return span(t);
  }
  function pointCount(j) {
    var a = j && (Array.isArray(j.locations) ? j.locations : (Array.isArray(j) ? j : null));
    return a ? a.length : 0;
  }

  // ---------- 2. iCalendar (TripIt) ----------
  function unfold(text) {
    var out = [];
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (l) {
      if ((l.charAt(0) === " " || l.charAt(0) === "\t") && out.length) out[out.length - 1] += l.slice(1);
      else if (l) out.push(l);
    });
    return out;
  }
  // "DTSTART;TZID=\"Europe/Athens\":2026…" → { name, params, value }
  function prop(l) {
    var q = false, i = 0;
    for (; i < l.length; i++) {
      var c = l.charAt(i);
      if (c === "\"") q = !q;
      else if (c === ":" && !q) break;
    }
    var head = l.slice(0, i).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/), params = {};
    head.slice(1).forEach(function (p) {
      var k = p.indexOf("=");
      if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, "");
    });
    return { name: head[0].toUpperCase(), params: params, value: l.slice(i + 1) };
  }
  function unesc(v) { return String(v || "").replace(/\\([nN,;\\])/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; }); }
  // an iCalendar date / date-time → { day, hm ("" for a date), allDay }
  function icsDt(p) {
    if (!p) return null;
    var v = p.value.trim(), m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m) return null;
    var day = m[1] + "-" + m[2] + "-" + m[3];
    if (!m[4] || p.params.VALUE === "DATE") return { day: day, hm: "", allDay: true };
    if (m[7]) return Object.assign(localWall(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))), { allDay: false });
    return { day: day, hm: m[4] + ":" + m[5], allDay: false };       // TZID or floating: as written
  }
  function parseIcs(text) {
    var evs = [], cur = null;
    unfold(String(text || "").slice(0, MAX_TEXT)).some(function (l) {
      if (/^BEGIN:VEVENT$/i.test(l)) { cur = {}; return false; }
      if (/^END:VEVENT$/i.test(l)) { if (cur) evs.push(cur); cur = null; return evs.length >= MAX_EVENTS; }
      if (!cur) return false;
      var p = prop(l);
      if (!cur[p.name]) cur[p.name] = p;
      return false;
    });
    return evs.map(function (e) {
      var s = icsDt(e.DTSTART), en = icsDt(e.DTEND);
      if (!s) return null;
      // an all-day DTEND is exclusive: the last day is the one before
      if (en && en.allDay && en.day > s.day) {
        var d = new Date(+en.day.slice(0, 4), +en.day.slice(5, 7) - 1, +en.day.slice(8, 10) - 1, 12);
        en.day = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      }
      var g = e.GEO ? e.GEO.value.split(/[;,]/) : [];
      return {
        uid: line(e.UID ? e.UID.value : "", 300), sum: line(unesc(e.SUMMARY && e.SUMMARY.value), 300),
        desc: txt(unesc(e.DESCRIPTION && e.DESCRIPTION.value), 4000), loc: line(unesc(e.LOCATION && e.LOCATION.value), 300),
        start: s, end: en, geo: g.length === 2 ? geoOf(g[0], g[1]) : null,
        cancelled: /^CANCELLED$/i.test(e.STATUS ? e.STATUS.value.trim() : "")
      };
    }).filter(Boolean);
  }
  var REF_RE = /(?:confirmation|booking|reservation|record locator|PNR)\s*(?:#|no\.?|number|code|ref\.?)?\s*[:#]?\s*([A-Z0-9]{5,12})\b/i;
  // one TripIt event → an itinerary entry (null for a stay's second half,
  // which only sets the check-out day of its stay)
  function segment(ev, stays) {
    var s = ev.sum, d = ev.desc, both = s + "\n" + d, m;
    var o = { id: idOf("tripit", ev.uid || s + "|" + ev.start.day + ev.start.hm), day: ev.start.day, t1: ev.start.hm,
              day2: "", t2: "", place: ev.loc, geo: ev.geo, note: d };
    var rm = REF_RE.exec(d);
    if (rm) o.ref = rm[1];
    var end = ev.end && !ev.end.allDay ? ev.end : null;
    // flights: "LH1234 ATH to MUC", "Flight: LH 1234 Athens to Munich"
    m = /^(?:[Ff]light:?\s*)?([A-Z0-9]{2}|[A-Z]{3})\s?(\d{1,4}[A-Z]?)\s+(.+?)\s+to\s+(.+)$/.exec(s);
    if (m && /\[(rail|cruise|ferry|ground transportation|transport)\]|\b(rail|train|bus|ferry)\b/i.test(both)) m = null;
    if (m || /\[flight\]/i.test(d)) {
      o.kind = "flight";
      if (m) { o.num = m[1].toUpperCase() + m[2]; o.from = m[3]; o.to = m[4]; }
      else o.title = s;
      if (end) { o.day2 = end.day !== o.day ? end.day : ""; o.t2 = end.hm; }
      return entry(o);
    }
    var lodging = /\[lodging\]|\[hotel\]/i.test(d) || /^(check[ -]?in|check[ -]?out|hotel)\b/i.test(s);
    if (lodging) {
      var name = s.replace(/^(check[ -]?in|check[ -]?out)\s*[:\-–]?\s*/i, "").trim() || s;
      var key = name.toLowerCase();
      if (/^check[ -]?out/i.test(s)) {
        if (stays[key]) { stays[key].day2 = ev.start.day; stays[key].t2 = ev.start.hm; return null; }
        o.kind = "stay"; o.title = name; o.day2 = ev.start.day; o.t2 = ev.start.hm; o.day = ""; o.t1 = "";
        return entry(o);
      }
      o.kind = "stay";
      o.title = name;
      if (ev.end && ev.end.day > o.day) o.day2 = ev.end.day;
      var st = entry(o);
      stays[key] = st;
      return st;
    }
    var tr = /^(.+?)\s+to\s+(.+)$/i.exec(s.replace(/^(rail|train|ferry|cruise|bus|transport(?:ation)?|ground transportation)\s*[:\-–]\s*/i, ""));
    var kind = /\[(parking|map|directions|note)\]/i.test(d) ? "other"
      : /\[rail\]|\b(rail|train)\b/i.test(both) ? "train" : /\[(cruise|ferry)\]|\bferry\b/i.test(both) ? "ferry"
      : /\[(car rental|car)\]|\b(car rental|car hire|rental car)\b/i.test(both) ? "rental"
      : /\[restaurant\]|\brestaurant\b|\b(dinner|lunch|breakfast)\b/i.test(both) ? "food"
      : /\bbus\b|\bcoach\b/i.test(s) ? "bus"
      : /\[(activity|concert|theater|theatre|tour|meeting)\]/i.test(d) ? "activity" : "";
    o.kind = kind || "other";
    if ((kind === "train" || kind === "ferry" || kind === "bus") && tr) { o.from = tr[1]; o.to = tr[2]; }
    else o.title = s;
    if (end) { o.day2 = end.day !== o.day ? end.day : ""; o.t2 = end.hm; }
    return entry(o);
  }
  function tripsFromIcs(text, fileName) {
    var evs = parseIcs(text), skip = { photos: 0, points: 0, outside: 0, cancelled: 0 };
    if (!evs.length) return null;
    var cont = [], segs = [];
    // all-day events that hold another event are trips; the rest are segments
    var allDay = evs.filter(function (e) { return e.start.allDay; });
    evs.forEach(function (e) {
      if (e.cancelled) { skip.cancelled++; return; }
      if (!e.start.allDay) { segs.push(e); return; }
      var last = e.end ? e.end.day : e.start.day;
      var inside = allDay.some(function (o) {
        var ol = o.end ? o.end.day : o.start.day;
        return o !== e && !o.cancelled && o.start.day <= e.start.day && last <= ol && (o.start.day < e.start.day || last < ol);
      });
      if (inside) segs.push(e); else cont.push(e);
    });
    var trips = cont.slice(0, MAX_TRIPS).map(function (e) {
      return { id: idOf("tripit", e.uid || e.sum + "|" + e.start.day), name: line(e.sum, LEN.name), dest: line(e.loc, LEN.dest),
               start: e.start.day, end: e.end ? e.end.day : e.start.day, notes: txt(e.desc, LEN.notes), entries: [], jrnl: [], points: 0, _stays: {} };
    });
    if (!trips.length) {
      var first = segs.slice().sort(function (a, b) { return (a.start.day + a.start.hm) < (b.start.day + b.start.hm) ? -1 : 1; })[0];
      if (!first) return null;
      trips.push({ id: idOf("tripit", first.uid || first.sum), name: line(String(fileName || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), LEN.name),
                   dest: "", start: "", end: "", notes: "", entries: [], jrnl: [], points: 0, _stays: {}, open: true });
    }
    var DAY = 86400000;
    function dist(t, day) {
      if (t.open) return 0;
      if (day >= t.start && day <= t.end) return 0;
      var a = Date.parse(day + "T12:00:00Z"), b = Date.parse((day < t.start ? t.start : t.end) + "T12:00:00Z");
      return Math.abs(a - b) / DAY;
    }
    segs.sort(function (a, b) { return (a.start.day + a.start.hm) < (b.start.day + b.start.hm) ? -1 : 1; });
    segs.forEach(function (e) {
      var best = null, bd = 2;                              // up to a day either side of the trip
      trips.forEach(function (t) { var d = dist(t, e.start.day); if (d < bd) { bd = d; best = t; } });
      if (!best) { skip.outside++; return; }
      if (best.entries.length >= MAX_ENTRIES) { skip.outside++; return; }
      var x = segment(e, best._stays);
      if (x) best.entries.push(x);
    });
    trips.forEach(function (t) {
      delete t._stays;
      delete t.open;
      if (!t.dest) {
        var st = t.entries.filter(function (x) { return x.kind === "stay"; })[0], fl = t.entries.filter(function (x) { return x.to; })[0];
        t.dest = line(st ? st.place || st.title : fl ? fl.to : "", LEN.dest);
      }
      if (!t.name) t.name = t.dest || "TripIt";
      span(t);
    });
    return { source: "tripit", trips: trips, skip: skip };
  }

  // ---------- 3. Reading a file ----------
  function fromPolarJson(j, name) {
    var t = polarTrip(j, 0);
    return t ? { source: "polarsteps", trips: [t], skip: { photos: 0, points: 0, outside: 0, cancelled: 0 } } : null;
  }
  function fromZip(bytes) {
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve(null); }
    var names = z.names.filter(function (n) { return !/(^|\/)(__MACOSX|\.)/.test(n); });
    var tripFiles = names.filter(function (n) { return /(^|\/)trip\.json$/i.test(n); }).slice(0, MAX_TRIPS);
    if (!tripFiles.length) return Promise.resolve(null);
    var res = { source: "polarsteps", trips: [], skip: { photos: 0, points: 0, outside: 0, cancelled: 0 } };
    names.forEach(function (n) { if (/\.(jpe?g|png|heic|mp4|mov)$/i.test(n)) res.skip.photos++; });
    var reads = 0;
    return tripFiles.reduce(function (p, n) {
      var dir = n.replace(/trip\.json$/i, "");
      return p.then(function () {
        if (++reads > MAX_ZIP_JSON) return;
        var loc = names.indexOf(dir + "locations.json") >= 0 ? z.text(dir + "locations.json", MAX_TEXT).catch(function () { return ""; }) : Promise.resolve("");
        return Promise.all([z.text(n, MAX_TEXT).catch(function () { return ""; }), loc]).then(function (r) {
          var pts = pointCount(K.json(r[1]));
          var t = polarTrip(K.json(r[0]), pts);
          if (!t) return;
          res.skip.points += pts;
          res.trips.push(t);
        });
      });
    }, Promise.resolve()).then(function () { return res.trips.length ? res : null; });
  }
  function read(name, bytes) {
    if (bytes == null) return Promise.resolve(null);
    if (typeof bytes !== "string" && bytes.length > MAX_FILE) return Promise.reject(new Error("toobig"));
    if (typeof bytes !== "string" && K.isZip(bytes)) return fromZip(bytes);
    var text = typeof bytes === "string" ? bytes : K.text(bytes);
    if (text.length > MAX_TEXT) return Promise.reject(new Error("toobig"));
    if (/^\s*BEGIN:VCALENDAR/i.test(text) || /\.ics$/i.test(String(name || ""))) return Promise.resolve(tripsFromIcs(text, name));
    var j = K.json(text);
    if (j && typeof j === "object" && Array.isArray(j.all_steps)) return Promise.resolve(fromPolarJson(j, name));
    return Promise.resolve(null);
  }

  // ---------- 4. What an import would add ----------
  // data: the app's data { trips: [...] } (already merged: no deleted
  // trips or entries in it). Nothing of a trip already here changes:
  // only its missing entries and journal days are added.
  function plan(data, res) {
    var trips = data && Array.isArray(data.trips) ? data.trips : [];
    return (res && res.trips || []).map(function (t) {
      var cur = null;
      trips.forEach(function (x) { if (x && x.id === t.id) cur = x; });
      var have = {}, days = {};
      if (cur) {
        (cur.plan || []).forEach(function (p) { have[p.id] = 1; });
        (cur.jrnl || []).forEach(function (j) { if (j && j.day) days[j.day] = 1; });
      }
      var room = MAX_ENTRIES - (cur ? (cur.plan || []).length : 0);
      var add = [], n = 0, over = 0;
      t.entries.forEach(function (e) {
        if (have[e.id]) { n++; return; }
        if (add.length >= room) { over++; return; }
        add.push(e);
      });
      return { trip: t, cur: cur, add: add, jrnl: t.jrnl.filter(function (j) { return YMD_RE.test(j.day) && !days[j.day]; }), have: n, over: over };
    });
  }

  var api = { ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, read: read, plan: plan, parseIcs: parseIcs, polarTrip: polarTrip,
              tripsFromIcs: tripsFromIcs, idOf: idOf };
  if (NODE) module.exports = api;
  else root.OrosTravelImport = api;
})(typeof window !== "undefined" ? window : this);
