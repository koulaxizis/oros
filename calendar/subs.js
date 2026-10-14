// ============================================================
// orOS Calendar — subscribed calendars (ICS feeds by address)
// Pure helpers: no DOM, no storage, no network (calendar.js fetches
// through the Reader's feeds/fetch.js and keeps the cache).
//
// A subscription (synced, inside oros-calendar-data `subs`):
//   { id, url, name, color, mtime }
//   url   https:// or http:// (webcal:// and webcals:// are turned
//         into https://), no user name / password in it, ≤ 2000.
//   name  ≤ 40 characters ("" = the feed's own name, else its host).
//   color one of the Calendar's label colours.
// Its events (device-local cache "oros-cal-subs-cache", never
// synced): the feed parsed by calendar/ics.js, trimmed to what the
// Calendar draws, no reminders, past one-off events older than a year
// dropped, at most MAX_EVENTS kept (nearest to today first).
//
//   normUrl(raw)                    → "" | the address to fetch
//   sanitizeSub(s, colors, strict)  → clean subscription | null
//                                     (strict: no mtime → null, for merge)
//   calName(text)                   → X-WR-CALNAME or ""
//   hostName(url)                   → "calendar.example.com"
//   fromIcs(text, today, Ics)       → { events, total, dropped, name }
//   cleanCache(entry)               → a cache entry read back from storage, or null
//   index(events, Occ)              → { days: {ymd: [i]}, rec: [i] }
//   rowsOn(events, idx, ymd, Occ)   → [{ ev, inst }] on that device day
//   due(entry, now, maxAgeMs)       → true when it should be fetched again
// Exposes window.OrosCalSubs and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_EVENTS = 3000;
  var KEEP_PAST_DAYS = 366;
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function normUrl(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || s.length > 2000) return "";
    s = s.replace(/^webcals?:\/\//i, "https://");
    if (!/^https?:\/\//i.test(s)) return "";
    var u;
    try { u = new URL(s); } catch (e) { return ""; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password || !u.hostname) return "";
    u.hash = "";
    return u.href.length > 2000 ? "" : u.href;
  }
  function hostName(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function sanitizeSub(s, colors, strict) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)) return null;
    var url = normUrl(s.url);
    if (!url) return null;
    if (colors && colors.indexOf(s.color) === -1) return null;
    var okM = typeof s.mtime === "number" && isFinite(s.mtime);
    if (strict && !okM) return null;
    return {
      id: s.id,
      url: url,
      name: (typeof s.name === "string" ? s.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "").slice(0, 40),
      color: s.color,
      mtime: okM ? s.mtime : 0
    };
  }

  // The calendar's own name from the file (unfolded first line only).
  function calName(text) {
    var m = /(?:^|\n)X-WR-CALNAME(?:;[^:\r\n]*)?:([^\r\n]*)/i.exec(String(text || "").slice(0, 20000));
    if (!m) return "";
    return m[1].replace(/\\([\\;,nN])/g, function (x, c) { return c === "n" || c === "N" ? " " : c; })
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function dayNum(s) { var p = s.split("-"); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function addDays(s, n) {
    var d = new Date((dayNum(s) + n) * 86400000);
    var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }

  // One cached event: the Calendar's own event shape, trimmed.
  function slim(e) {
    var o = { id: String(e.id).slice(0, 64), date: e.date, dateEnd: e.dateEnd || null,
              start: e.start || null, end: e.end || null,
              title: String(e.title || "").slice(0, 80), location: String(e.location || "").slice(0, 150),
              note: String(e.note || "").slice(0, 300), recur: e.recur || null };
    if (e.tz && o.start) o.tz = e.tz;
    return o;
  }

  function fromIcs(text, today, Ics) {
    Ics = Ics || (root && root.OrosIcs) ||
      (typeof require === "function" ? require("./ics.js") : null);
    var res = Ics.parse(String(text || ""));
    var cut = addDays(today, -KEEP_PAST_DAYS);
    var keep = [];
    res.events.forEach(function (e) {
      var last = e.recur ? (e.recur.until || "9999-12-31") : (e.dateEnd || e.date);
      if (last < cut) return;
      keep.push(slim(e));
    });
    var total = keep.length;
    if (keep.length > MAX_EVENTS) {
      var t = dayNum(today);
      keep.sort(function (a, b) {
        var da = a.recur ? 0 : Math.abs(dayNum(a.date) - t), db = b.recur ? 0 : Math.abs(dayNum(b.date) - t);
        return da - db || (a.id < b.id ? -1 : 1);
      });
      keep = keep.slice(0, MAX_EVENTS);
    }
    keep.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); });
    return { events: keep, total: res.found, dropped: total - keep.length, name: calName(text) };
  }

  // Whatever comes back from localStorage is checked again.
  function cleanEv(e) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !YMD_RE.test(e.date || "")) return null;
    var o = slim(e);
    if (o.dateEnd && (!YMD_RE.test(o.dateEnd) || o.dateEnd < o.date)) o.dateEnd = null;
    if (o.start && !HM_RE.test(o.start)) { o.start = null; o.end = null; delete o.tz; }
    if (o.end && !HM_RE.test(o.end)) o.end = null;
    if (o.recur && (typeof o.recur !== "object" || !/^[DWMY]$/.test(o.recur.freq || ""))) o.recur = null;
    if (o.tz && !/^[A-Za-z][A-Za-z0-9_+\-\/]{0,63}$/.test(o.tz)) delete o.tz;
    return o;
  }
  function cleanCache(x) {
    if (!x || typeof x !== "object") return null;
    var num = function (v) { return typeof v === "number" && isFinite(v) ? v : 0; };
    return {
      url: typeof x.url === "string" ? x.url : "",
      at: num(x.at), ok: num(x.ok),
      err: typeof x.err === "string" ? x.err.slice(0, 40) : "", n: num(x.n),
      name: typeof x.name === "string" ? x.name.slice(0, 40) : "",
      total: num(x.total), dropped: num(x.dropped),
      events: Array.isArray(x.events) ? x.events.slice(0, MAX_EVENTS).map(cleanEv).filter(Boolean) : []
    };
  }

  // Day index: one-off events by the device days they cover (after
  // their time zone is applied), series kept aside for occur.js.
  function index(events, Occ) {
    var days = {}, rec = [];
    events.forEach(function (e, i) {
      if (e.recur) { rec.push(i); return; }
      var inst = Occ.instance(e, e.date);
      var d = inst.date, end = inst.dateEnd || inst.date, n = 0;
      while (d <= end && n < 400) {
        (days[d] || (days[d] = [])).push(i);
        d = addDays(d, 1);
        n++;
      }
    });
    return { days: days, rec: rec };
  }
  function rowsOn(events, idx, ymd, Occ) {
    var out = [];
    (idx.days[ymd] || []).forEach(function (i) {
      var e = events[i];
      out.push({ ev: e, inst: Occ.instance(e, e.date) });
    });
    idx.rec.forEach(function (i) {
      var e = events[i], inst = Occ.instanceOn(e, ymd);
      if (inst) out.push({ ev: e, inst: inst });
    });
    return out;
  }

  function due(entry, now, maxAge) {
    if (!entry || !entry.at) return true;
    if (entry.at > now) return true;                    // clock went back
    return now - entry.at >= maxAge;
  }

  var api = { MAX_EVENTS: MAX_EVENTS, normUrl: normUrl, hostName: hostName, sanitizeSub: sanitizeSub,
              calName: calName, fromIcs: fromIcs, cleanCache: cleanCache, index: index, rowsOn: rowsOn, due: due };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosCalSubs = api;
})(typeof window !== "undefined" ? window : null);
