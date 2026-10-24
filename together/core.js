// ============================================================
// orOS Together — data model and date math (pure, no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// Inspired by the features of "Since Us" (DerDieDasLian, GPL-3.0);
// no code, text or art of it is used here.
// Data in localStorage "oros-together-data" (slice "together"):
//   { ver: 1,
//     rels:    [{ id, m, people: [{ c?, n }], title, start "YYYY-MM-DD",
//                 time "HH:MM"|"", kind, pron, discreet, cover, pos,
//                 ord, arch }],
//     moments: [{ id, m, rel, date, title, note, photo, yearly, place }],
//     days:    [{ id, m, rel, date, title, yearly }],
//     meets:   [{ id, m, rel, date, time, tz, place }],
//     prefs:   { m, me, live, kinds{month,year,d100,w50,fun}, hour,
//                notify{…}, confetti },
//     tombs:   { id: ms } }
// Sync rules (OROS_BIBLE.md Part I, Part VI):
//   - merge(a, b) === merge(b, a): union by id, the newer m wins, a
//     tie goes to the larger JSON (R5), never "local wins";
//   - merge(a, a) === a, so a pull never makes the slice dirty;
//   - a tombstone at least as new as the item deletes it, a newer
//     edit brings it back (R17); deleting a relationship tombstones
//     its moments, days and meetings too (the app does it);
//   - no uid() or Date.now() inside the merge; bad rows are dropped;
//   - serialize() is canonical: lists sorted by id, keys in order.
// Photos are never stored here: only a path on the orOS disk
// (/internal/…), the picture itself is a file (CT-NP lesson).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var LISTS = ["rels", "moments", "days", "meets"];
  var KINDS = ["couple", "engaged", "married", "partners", "friends", "other"];
  var MS_KINDS = ["month", "year", "d100", "w50", "fun"];
  var NOTIFY = ["month", "year", "d100", "w50", "fun", "moments", "days", "bdays", "meets"];
  var MAX_PEOPLE = 8;

  // ---------- small checks ----------
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ").slice(0, max) : ""; }
  function line(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").trim().slice(0, max); }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function dim(y, mo) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]; }
  function parseYmd(s) {
    var m = YMD_RE.exec(typeof s === "string" ? s : "");
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > dim(y, mo)) return null;
    return { y: y, mo: mo, d: d };
  }
  function okYmd(s) { return !!parseYmd(s); }
  function okHm(s) { return typeof s === "string" && HM_RE.test(s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, mo, d) { return y + "-" + pad(mo) + "-" + pad(d); }
  // A path on the orOS disk: /internal/…, no "..", no control chars.
  function okPath(p) {
    return typeof p === "string" && p.length <= 300 && /^\/internal\/[^\u0000-\u001f]+$/.test(p) &&
      p.split("/").indexOf("..") < 0 && p.split("/").indexOf(".") < 0;
  }

  // ---------- rows ----------
  function cleanId(v) { var s = str(v, 64); return /^[A-Za-z0-9_-]+$/.test(s) ? s : ""; }

  function cleanPeople(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
      if (!p || typeof p !== "object" || out.length >= MAX_PEOPLE) return;
      var c = cleanId(p.c), n = line(p.n, 60);
      if (!c && !n) return;
      var o = {};
      if (c) o.c = c;
      o.n = n;
      out.push(o);
    });
    return out;
  }

  var CLEAN = {
    rels: function (r) {
      if (!okYmd(r.start)) return null;
      var pos = typeof r.pos === "number" && isFinite(r.pos) ? Math.max(0, Math.min(100, Math.round(r.pos))) : 50;
      return {
        people: cleanPeople(r.people),
        title: line(r.title, 60),
        start: r.start,
        time: okHm(r.time) ? r.time : "",
        kind: KINDS.indexOf(r.kind) >= 0 ? r.kind : "couple",
        pron: line(r.pron, 24),
        discreet: r.discreet === true,
        cover: okPath(r.cover) ? r.cover : "",
        pos: pos,
        ord: typeof r.ord === "number" && isFinite(r.ord) ? r.ord : 0,
        arch: r.arch === true
      };
    },
    moments: function (r) {
      var rel = cleanId(r.rel);
      if (!rel || !okYmd(r.date)) return null;
      return {
        rel: rel, date: r.date, title: line(r.title, 120), note: str(r.note, 4000).replace(/\r\n?/g, "\n"),
        photo: okPath(r.photo) ? r.photo : "", yearly: r.yearly === true, place: line(r.place, 150)
      };
    },
    days: function (r) {
      var rel = cleanId(r.rel);
      if (!rel || !okYmd(r.date)) return null;
      return { rel: rel, date: r.date, title: line(r.title, 120), yearly: r.yearly === true };
    },
    meets: function (r) {
      var rel = cleanId(r.rel);
      if (!rel || !okYmd(r.date)) return null;
      return { rel: rel, date: r.date, time: okHm(r.time) ? r.time : "", tz: line(r.tz, 64), place: line(r.place, 150) };
    }
  };

  function cleanRow(list, raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = cleanId(raw.id);
    if (!id) return null;
    var body = CLEAN[list](raw);
    if (!body) return null;
    var out = { id: id, m: ms(raw.m) };
    Object.keys(body).forEach(function (k) { out[k] = body[k]; });
    return out;
  }

  function defaultPrefs() {
    var kinds = {}, notify = {};
    MS_KINDS.forEach(function (k) { kinds[k] = true; });
    NOTIFY.forEach(function (k) { notify[k] = k !== "month" && k !== "fun"; });
    return { m: 0, me: "", live: true, kinds: kinds, hour: 9, notify: notify, confetti: true };
  }
  function cleanPrefs(p) {
    var d = defaultPrefs();
    if (!p || typeof p !== "object") return d;
    d.m = ms(p.m);
    d.me = line(p.me, 60);
    if (typeof p.live === "boolean") d.live = p.live;
    if (typeof p.confetti === "boolean") d.confetti = p.confetti;
    if (typeof p.hour === "number" && p.hour >= 0 && p.hour <= 23) d.hour = Math.floor(p.hour);
    MS_KINDS.forEach(function (k) { if (p.kinds && typeof p.kinds[k] === "boolean") d.kinds[k] = p.kinds[k]; });
    NOTIFY.forEach(function (k) { if (p.notify && typeof p.notify[k] === "boolean") d.notify[k] = p.notify[k]; });
    return d;
  }

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return JSON.stringify(a) > JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function empty() {
    return { ver: VER, rels: [], moments: [], days: [], meets: [], prefs: defaultPrefs(), tombs: {} };
  }

  function mergeAll(list) {
    var maps = {}, tombs = {}, prefs = null;
    LISTS.forEach(function (k) { maps[k] = {}; });
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      LISTS.forEach(function (k) {
        (Array.isArray(d[k]) ? d[k] : []).forEach(function (raw) {
          var r = cleanRow(k, raw);
          if (r && (!maps[k][r.id] || newer(r, maps[k][r.id]))) maps[k][r.id] = r;
        });
      });
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && cleanId(id) === id && at > (tombs[id] || 0)) tombs[id] = at;
      });
      if (d.prefs) {
        var p = cleanPrefs(d.prefs);
        if (!prefs || newer(p, prefs)) prefs = p;
      }
    });
    var out = empty();
    LISTS.forEach(function (k) {
      out[k] = Object.keys(maps[k]).map(function (id) { return maps[k][id]; })
        .filter(function (r) { return !(tombs[r.id] >= r.m); })
        .sort(byId);
    });
    out.prefs = prefs || defaultPrefs();
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  function normalize(d) { return mergeAll([d]); }
  function merge(a, b) { return mergeAll([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- edits (the app passes the clock in) ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function find(d, list, id) {
    var arr = d && Array.isArray(d[list]) ? d[list] : [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  // Insert or replace one row; the stamp only moves on a real change
  // (R27), and always past the old one.
  function put(d, list, row, now) {
    var out = normalize(d);
    var old = find(out, list, row.id);
    var probe = cleanRow(list, Object.assign({}, old || {}, row, { m: old ? old.m : 0 }));
    if (!probe) return out;
    if (old && JSON.stringify(probe) === JSON.stringify(old)) return out;
    probe.m = Math.max(now, old ? old.m + 1 : 0, (out.tombs[probe.id] || 0) + 1);
    out[list] = out[list].filter(function (r) { return r.id !== probe.id; }).concat([probe]);
    return normalize(out);
  }

  function remove(d, list, id, now) {
    var out = normalize(d);
    var old = find(out, list, id);
    var ids = [id];
    if (list === "rels") {
      ["moments", "days", "meets"].forEach(function (k) {
        out[k].forEach(function (r) { if (r.rel === id) ids.push(r.id); });
      });
    }
    ids.forEach(function (x) {
      var row = null;
      LISTS.forEach(function (k) { row = row || find(out, k, x); });
      out.tombs[x] = Math.max(now, row ? row.m : 0, old ? old.m : 0);
    });
    return normalize(out);
  }

  function setPrefs(d, patch, now) {
    var out = normalize(d);
    var next = cleanPrefs(Object.assign({}, out.prefs, patch, {
      kinds: Object.assign({}, out.prefs.kinds, patch && patch.kinds),
      notify: Object.assign({}, out.prefs.notify, patch && patch.notify)
    }));
    next.m = out.prefs.m;
    if (JSON.stringify(next) === JSON.stringify(out.prefs)) return out;
    next.m = Math.max(now, out.prefs.m + 1);
    out.prefs = next;
    return out;
  }

  // Living relationships, in the user's order (archived last).
  function liveRels(d, withArchived) {
    return normalize(d).rels.filter(function (r) { return withArchived || !r.arch; }).sort(function (a, b) {
      if (a.arch !== b.arch) return a.arch ? 1 : -1;
      if (a.ord !== b.ord) return a.ord - b.ord;
      return a.start < b.start ? -1 : a.start > b.start ? 1 : byId(a, b);
    });
  }

  // ---------- dates ----------
  function dayNum(s) { var p = parseYmd(s); return p ? Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 86400000) : NaN; }
  function fromDayNum(n) { var dt = new Date(n * 86400000); return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  // n months after s; a day the month does not have becomes its last
  // day (31 Jan + 1 month = 28/29 Feb; 29 Feb + 1 year = 28 Feb).
  function addMonths(s, n) {
    var p = parseYmd(s);
    var t = p.y * 12 + (p.mo - 1) + n, y = Math.floor(t / 12), mo = t - y * 12 + 1;
    return ymd(y, mo, Math.min(p.d, dim(y, mo)));
  }
  function todayYmd(now) { var dt = new Date(now); return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  // Local time of the start (the time, else midnight).
  function startMs(rel) {
    var p = parseYmd(rel.start), hm = okHm(rel.time) ? rel.time.split(":") : ["0", "0"];
    return new Date(p.y, p.mo - 1, p.d, +hm[0], +hm[1]).getTime();
  }

  // Whole months from a to b (b ≥ a): the largest n with addMonths(a, n) ≤ b.
  function monthsBetween(a, b) {
    var pa = parseYmd(a), pb = parseYmd(b);
    var n = (pb.y - pa.y) * 12 + (pb.mo - pa.mo);
    if (n > 0 && addMonths(a, n) > b) n--;
    return Math.max(0, n);
  }

  // How long since the start, on day `today` and at time `now`.
  // future: the start has not come yet (the counter counts down).
  function elapsed(rel, today, now) {
    var start = rel.start, future = today < start;
    var a = future ? today : start, b = future ? start : today;
    var months = monthsBetween(a, b);
    var days = daysBetween(addMonths(a, months), b);
    var total = daysBetween(a, b);
    var diff = Math.abs(now - startMs(rel));
    return {
      future: future,
      years: Math.floor(months / 12), months: months % 12, days: days,
      totalMonths: months, totalDays: total, totalWeeks: Math.floor(total / 7), weekDays: total % 7,
      totalHours: Math.floor(diff / 3600000), totalMinutes: Math.floor(diff / 60000), totalSeconds: Math.floor(diff / 1000)
    };
  }

  // ---------- milestones ----------
  // Fun numbers of days: repdigits (111 … 99999), runs (123, 1234,
  // 12345) and 10000 / 20000; time units: 10 000 and 100 000 hours,
  // 1 and 10 million minutes, 100 million and 1 billion seconds.
  var FUN_DAYS = (function () {
    var out = [123, 1234, 12345, 2345, 3456, 4567, 5678, 6789, 10000, 20000];
    for (var len = 3; len <= 5; len++) for (var dgt = 1; dgt <= 9; dgt++) out.push(+String(dgt).repeat(len));
    return out.filter(function (n) { return n % 100 !== 0 || n % 1000 === 0 && n >= 10000; })
      .filter(function (n, i, a) { return a.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
  })();
  var FUN_TIME = [
    { n: 10000, u: "h", ms: 3600000 }, { n: 100000, u: "h", ms: 3600000 },
    { n: 1000000, u: "min", ms: 60000 }, { n: 10000000, u: "min", ms: 60000 },
    { n: 100000000, u: "s", ms: 1000 }, { n: 1000000000, u: "s", ms: 1000 }
  ];

  // Every milestone from `from` to `to` (both "YYYY-MM-DD", inclusive),
  // sorted by date. Row: { date, time?, kind, n, u? }.
  //   month  n months (not whole years)      year   n years
  //   d100   n days, a multiple of 100       w50    n weeks, a multiple of 50
  //   fun    n days (u "d") or n hours / minutes / seconds (u, time)
  // 10000 days counts as d100, not twice.
  function milestones(rel, from, to, kinds) {
    var out = [], k = kinds || {};
    var on = function (x) { return k[x] !== false; };
    if (!okYmd(rel.start) || !okYmd(from) || !okYmd(to) || to < from) return out;
    var start = rel.start;
    var lo = from < start ? start : from;
    if (to <= start) return out;
    function add(date, kind, n, extra) {
      if (date <= start || date < from || date > to) return;
      var r = { date: date, kind: kind, n: n };
      if (extra) Object.keys(extra).forEach(function (x) { r[x] = extra[x]; });
      out.push(r);
    }
    var m0 = Math.max(1, monthsBetween(start, lo)), m1 = monthsBetween(start, to);
    for (var mo = m0; mo <= m1 + 1; mo++) {
      var d = addMonths(start, mo);
      if (mo % 12 === 0) { if (on("year")) add(d, "year", mo / 12); }
      else if (on("month")) add(d, "month", mo);
    }
    var d0 = daysBetween(start, lo), d1 = daysBetween(start, to);
    if (on("d100")) for (var n = Math.max(100, Math.ceil(d0 / 100) * 100); n <= d1; n += 100) add(addDays(start, n), "d100", n);
    if (on("w50")) for (var w = Math.max(50, Math.ceil(d0 / 350) * 50); w * 7 <= d1; w += 50) add(addDays(start, w * 7), "w50", w);
    if (on("fun")) {
      FUN_DAYS.forEach(function (n) { if (n % 100 !== 0 || !on("d100")) add(addDays(start, n), "fun", n, { u: "d" }); });
      var s0 = startMs(rel);
      FUN_TIME.forEach(function (f) {
        var dt = new Date(s0 + f.n * f.ms);
        add(ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()), "fun", f.n, { u: f.u, time: pad(dt.getHours()) + ":" + pad(dt.getMinutes()) });
      });
    }
    var RANK = { year: 0, d100: 1, w50: 2, month: 3, fun: 4 };
    return out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (RANK[a.kind] !== RANK[b.kind]) return RANK[a.kind] - RANK[b.kind];
      return a.n - b.n;
    });
  }

  // The next `count` milestones from today on (today's included).
  function upcoming(rel, today, count, kinds) {
    if (today < rel.start) return [];
    var horizon = 400, rows = [];
    while (rows.length < count && horizon <= 400 * 32) {
      rows = milestones(rel, today, addDays(today, horizon), kinds);
      horizon *= 2;
    }
    return rows.slice(0, count);
  }

  // The last `count` milestones before today.
  function recent(rel, today, count, kinds) {
    if (today <= rel.start) return [];
    var rows = milestones(rel, addDays(today, -800) < rel.start ? rel.start : addDays(today, -800), addDays(today, -1), kinds);
    return rows.slice(-count).reverse();
  }

  // ---------- names ----------
  // contactsRaw = oros-contacts-data (read only). A person linked to a
  // contact shows that contact's current name; a deleted contact keeps
  // the name stored with the link.
  function contactIndex(raw) {
    var idx = {};
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.contacts)) return idx;
    var gone = {};
    (Array.isArray(raw.deleted) ? raw.deleted : []).forEach(function (t) {
      if (t && typeof t.id === "string") gone[t.id] = Math.max(gone[t.id] || 0, typeof t.mtime === "number" ? t.mtime : 0);
    });
    raw.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.del) return;
      if (c.id in gone && gone[c.id] >= (typeof c.mtime === "number" ? c.mtime : 0)) return;
      var n = [c.given, c.middle, c.family].filter(function (x) { return typeof x === "string" && x.trim(); }).join(" ").trim() ||
        (typeof c.nickname === "string" ? c.nickname.trim() : "") || (typeof c.org === "string" ? c.org.trim() : "");
      if (!n) return;
      idx[c.id] = { id: c.id, name: line(n, 60), events: Array.isArray(c.events) ? c.events : [] };
    });
    return idx;
  }
  function personName(p, idx) { return (p.c && idx && idx[p.c] && idx[p.c].name) || p.n || "?"; }
  function initials(name) {
    return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) {
      return Array.from(w)[0].toUpperCase();
    }).join("") || "?";
  }
  // The names of a relationship: its title, else "me & A & B".
  // discreet → initials only (also the title).
  function relName(rel, idx, me, discreetOk) {
    var discreet = rel.discreet && discreetOk !== false;
    var names = rel.people.map(function (p) { return personName(p, idx); });
    if (rel.title) return discreet ? initials(rel.title) : rel.title;
    if (discreet) names = names.map(initials);
    if (me) names.unshift(discreet ? initials(me) : me);
    return names.join(" & ") || "?";
  }

  // Birthdays of the linked people (from Contacts), as "MM-DD" + id.
  function birthdays(rel, idx) {
    var out = [];
    rel.people.forEach(function (p) {
      var c = p.c && idx[p.c];
      if (!c) return;
      c.events.forEach(function (ev) {
        if (ev && ev.type === "birthday" && typeof ev.day === "string" && /^\d{2}-\d{2}$/.test(ev.day)) {
          out.push({ c: c.id, name: c.name, day: ev.day, year: typeof ev.year === "number" ? ev.year : 0 });
        }
      });
    });
    return out;
  }

  // ---------- PIN lock (device-local privacy screen) ----------
  // Same scheme as the Diary's: PBKDF2-SHA-256, a salted hash in
  // "oros-together-lock" on this device. Not encryption.
  var PIN_ITER = 150000;
  function pinOk(pin) { return typeof pin === "string" && /^\d{4,8}$/.test(pin); }
  function b64(bytes) {
    var u8 = new Uint8Array(bytes), s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }
  function unb64(s) {
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function derive(subtle, pin, salt, iter) {
    return subtle.importKey("raw", new TextEncoder().encode(pin), { name: "PBKDF2" }, false, ["deriveBits"]).then(function (k) {
      return subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, 256);
    });
  }
  function makeLock(cryptoObj, pin, iter) {
    if (!pinOk(pin)) return Promise.reject(new Error("pin"));
    var salt = new Uint8Array(16);
    cryptoObj.getRandomValues(salt);
    var it = iter || PIN_ITER;
    return derive(cryptoObj.subtle, pin, salt, it).then(function (bits) { return { v: 1, s: b64(salt), h: b64(bits), it: it }; });
  }
  function readLock(raw) {
    if (!raw || typeof raw !== "object" || raw.v !== 1) return null;
    if (typeof raw.s !== "string" || typeof raw.h !== "string" || typeof raw.it !== "number") return null;
    if (raw.it < 1000 || raw.it > 5000000) return null;
    return raw;
  }
  function checkPin(cryptoObj, lock, pin) {
    lock = readLock(lock);
    if (!lock || !pinOk(pin)) return Promise.resolve(false);
    return derive(cryptoObj.subtle, pin, unb64(lock.s), lock.it).then(function (bits) {
      var a = new Uint8Array(bits), b = unb64(lock.h), diff = a.length ^ b.length;
      for (var i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
      return diff === 0;
    });
  }
  function lockWait(fails) { return fails < 5 ? 0 : Math.min(300, 15 * Math.pow(2, fails - 5)); }

  var API = {
    VER: VER, KINDS: KINDS, MS_KINDS: MS_KINDS, NOTIFY: NOTIFY, MAX_PEOPLE: MAX_PEOPLE, FUN_DAYS: FUN_DAYS,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize,
    uid: uid, find: find, put: put, remove: remove, setPrefs: setPrefs, liveRels: liveRels, okPath: okPath,
    parseYmd: parseYmd, okYmd: okYmd, okHm: okHm, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween,
    monthsBetween: monthsBetween, todayYmd: todayYmd, startMs: startMs, isLeap: isLeap,
    elapsed: elapsed, milestones: milestones, upcoming: upcoming, recent: recent,
    contactIndex: contactIndex, personName: personName, initials: initials, relName: relName, birthdays: birthdays,
    pinOk: pinOk, makeLock: makeLock, readLock: readLock, checkPin: checkPin, lockWait: lockWait,
    LOCK_KEY: "oros-together-lock"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.TogetherCore = API;
})(typeof window !== "undefined" ? window : globalThis);
