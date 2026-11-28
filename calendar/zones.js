// ============================================================
// orOS Calendar — time zones side by side (CZ-1)
// Up to 3 extra time zones next to the hours of the Day view (and a
// short line over the Week view), picked from the World clock places
// of the Time app (oros-time-data "zones", read only).
// Pure logic, no DOM; calendar/calendar.js draws it. UMD:
// window.OrosCalZones in the app, module.exports under Node for
// tests/calendar-zones.test.js.
//
// Synced slice "calzones", localStorage "oros-calendar-zones":
//   { zones: [ { tz, city? } ] (at most MAX, no zone twice),
//     mtime: ms of the last change on any device }
// The whole list is one setting: newer mtime wins, an equal mtime
// keeps the smaller JSON (same answer on every device; never
// Date.now() inside the merge). merge(x, null) is the canonical
// form, so an unchanged device never uploads again.
// ============================================================
(function (root) {
  "use strict";

  var MAX = 3;

  function validZone(tz) {
    if (typeof tz !== "string" || !tz || tz.length > 64) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  function cleanCity(c) {
    if (typeof c !== "string") return "";
    return c.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
  }
  // One place: { tz, city? } (city left out when empty, like Time).
  function place(z) {
    if (!z || typeof z !== "object" || !validZone(z.tz)) return null;
    var out = { tz: z.tz }, c = cleanCity(z.city);
    if (c) out.city = c;
    return out;
  }
  function placeList(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (z) {
      var p = place(z);
      if (!p || seen[p.tz] || out.length >= MAX) return;
      seen[p.tz] = 1;
      out.push(p);
    });
    return out;
  }
  function sanitize(d) {
    if (!d || typeof d !== "object") return { zones: [], mtime: 0 };
    var m = (typeof d.mtime === "number" && isFinite(d.mtime) && d.mtime > 0) ? d.mtime : 0;
    return { zones: placeList(d.zones), mtime: m };
  }
  function merge(a, b) {
    var x = sanitize(a), y = (b == null) ? null : sanitize(b);
    if (!y) return x;
    if (y.mtime > x.mtime) return y;
    if (x.mtime > y.mtime) return x;
    return JSON.stringify(y) < JSON.stringify(x) ? y : x;
  }
  // A new list chosen on this device (stamped now by the caller).
  function setZones(list, now) {
    return { zones: placeList(list), mtime: (typeof now === "number" && isFinite(now) && now > 0) ? now : 0 };
  }

  // The World clock places of the Time app (its "zones" rows), in
  // their order; the rows Time keeps as strings (before its sync) too.
  function worldClock(timeData) {
    var rows = (timeData && typeof timeData === "object" && Array.isArray(timeData.zones)) ? timeData.zones : [];
    var out = [], seen = {};
    rows.forEach(function (z) {
      var p = place(typeof z === "string" ? { tz: z } : z);
      if (!p || seen[p.tz]) return;
      seen[p.tz] = 1;
      out.push(p);
    });
    return out;
  }

  /* ---------- clock arithmetic ---------- */
  var fmts = {};
  function fmt(tz) {
    if (!fmts[tz]) {
      fmts[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      });
    }
    return fmts[tz];
  }
  // Wall clock of an instant in a zone: { ymd "YYYY-MM-DD", hm "HH:MM" }.
  function wall(tz, ms) {
    var p = {};
    fmt(tz).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var h = p.hour === "24" ? "00" : p.hour;
    return { ymd: p.year + "-" + p.month + "-" + p.day, hm: h + ":" + p.minute };
  }
  function dayDiff(a, b) {
    var pa = a.split("-"), pb = b.split("-");
    var da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((da - db) / 86400000);
  }
  // The 24 hour lines of one day of THIS device ("YYYY-MM-DD"), as
  // read in another zone: [{ hm "HH:MM", dd −1|0|+1 against the
  // local day }]. Built from real instants, so summer time on either
  // side and half-hour zones come out right on that very day.
  function hourCells(ymd, tz) {
    var p = String(ymd).split("-"), out = [];
    for (var h = 0; h < 24; h++) {
      var ms = new Date(+p[0], +p[1] - 1, +p[2], h, 0, 0, 0).getTime();
      var w = wall(tz, ms);
      out.push({ hm: w.hm, dd: dayDiff(w.ymd, ymd) });
    }
    return out;
  }
  // Minutes the zone is ahead of this device at that instant.
  function offsetMin(tz, ms) {
    var w = wall(tz, ms), d = new Date(ms);
    var loc = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    var wm = (+w.hm.slice(0, 2)) * 60 + (+w.hm.slice(3));
    return dayDiff(w.ymd, loc) * 1440 + wm - (d.getHours() * 60 + d.getMinutes());
  }
  // "+2", "−7", "+5:30", "0" (true minus sign).
  function diffLabel(min) {
    if (!min) return "0";
    var s = min > 0 ? "+" : "−", a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return s + h + (m ? ":" + ("0" + m).slice(-2) : "");
  }
  // A place's wall time for an event start "HH:MM" on a local day.
  function atLocal(ymd, hm, tz) {
    var p = String(ymd).split("-"), q = String(hm).split(":");
    var ms = new Date(+p[0], +p[1] - 1, +p[2], +q[0], +q[1], 0, 0).getTime();
    var w = wall(tz, ms);
    return { hm: w.hm, dd: dayDiff(w.ymd, ymd) };
  }

  // A short column head: the first word, at most 6 letters ("New"
  // would say little, so two words become initials: "NY", "LA").
  function shortName(name) {
    var s = String(name || "").trim();
    if (!s) return "";
    var words = s.split(/[\s\-]+/).filter(Boolean);
    if (words.length > 1 && s.length > 7) {
      return words.map(function (w) { return w.charAt(0).toUpperCase(); }).join("").slice(0, 4);
    }
    return s.length > 7 ? s.slice(0, 6) + "." : s;
  }

  var API = {
    MAX: MAX, KEY: "oros-calendar-zones", SLICE: "calzones",
    validZone: validZone, sanitize: sanitize, merge: merge, setZones: setZones,
    worldClock: worldClock, hourCells: hourCells, offsetMin: offsetMin,
    diffLabel: diffLabel, atLocal: atLocal, shortName: shortName, wall: wall
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCalZones = API;
})(typeof window !== "undefined" ? window : null);
