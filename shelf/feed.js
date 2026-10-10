// ============================================================
// orOS Media Shelf — feed.js (Calendar feed + reading reminder, v1.1.0)
// The Calendar (calendar/index.html loads this file) shows, under
// the chip "Media Shelf" / «Το ράφι μου»:
//   - every finish (session kind "d"): "Finished: Dune" on that day,
//     rewatches and rereads included (one row per title per day);
//   - the release date of wishlist titles that have one (item field
//     `rel`, set by hand or by the online lookup): "Release: …".
// Nothing is stored or synced by it; it only reads Media Shelf's
// own blob (synced slice "shelf", key oros-shelf-data).
//
// API (window.OrosShelfFeed):
//   byDay(data) → { "YYYY-MM-DD": [{ item, k ("d"|"r"), title }] }
//   label(k, title, lang) → "Finished: Dune" | "Κυκλοφορία: Dune"
//
// Reading reminder (since 1.3.0; the shell also loads this file and
// owns timing + emission, so it works with the app closed):
//   REM_KEY = "oros-shelf-rem" (device-local, never synced or backed up)
//   readRem(x) → { on: 0|1, h: 0–23 } (off by default, 20:00)
//   reminderDue(data, rem, now) → null | { key, item, title, type, fmt, v, size }
//     Once a day ("read-YYYY-MM-DD"), from hour h on, only when a title
//     is in Now and nothing at all was logged today. It names the
//     Now title with the latest activity and its current progress.
//   reminderText(due, lang) → { title, body }
// Data: items [{ id, m, title, st, rel? }], sess [{ id, m, it, k, d }],
//   tombs { id: ms } (a tombstoned item or session shows nothing).
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[a-z0-9]{6,40}$/;   // same as shelf.js
  var MAX_ROWS = 20000;

  var TEXT = {
    en: { d: "Finished: {t}", r: "Release: {t}" },
    el: { d: "Τελείωσα: {t}", r: "Κυκλοφορία: {t}" }
  };

  function str(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n) : "";
  }
  function dead(tombs, x) {
    return Object.prototype.hasOwnProperty.call(tombs, x.id) &&
           typeof tombs[x.id] === "number" && tombs[x.id] >= (x.m || 0);
  }

  function byDay(data) {
    var out = {};
    if (!data || typeof data !== "object") return out;
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var items = {}, rows = 0;
    (Array.isArray(data.items) ? data.items : []).forEach(function (it) {
      if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id) || dead(tombs, it)) return;
      var title = str(it.title, 200);
      if (!title) return;
      items[it.id] = title;
      if (it.st === "want" && typeof it.rel === "string" && YMD_RE.test(it.rel) && rows < MAX_ROWS) {
        (out[it.rel] = out[it.rel] || []).push({ item: it.id, k: "r", title: title });
        rows++;
      }
    });
    var seen = {};
    (Array.isArray(data.sess) ? data.sess : []).forEach(function (s) {
      if (!s || typeof s !== "object" || s.k !== "d" || typeof s.it !== "string" ||
          typeof s.d !== "string" || !YMD_RE.test(s.d) || !items[s.it] || dead(tombs, s)) return;
      var key = s.d + "|" + s.it;
      if (seen[key] || rows >= MAX_ROWS) return;
      seen[key] = 1;
      (out[s.d] = out[s.d] || []).push({ item: s.it, k: "d", title: items[s.it] });
      rows++;
    });
    Object.keys(out).forEach(function (d) {
      out[d].sort(function (a, b) {
        if (a.k !== b.k) return a.k === "r" ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    });
    return out;
  }

  // ---------- Reading reminder ----------
  var REM_KEY = "oros-shelf-rem";
  var REM_HOUR = 20;
  var REM_TEXT = {
    en: {
      t: { book: "Time to read", film: "Time to watch", series: "Time to watch", album: "Time to listen",
           podcast: "Time to listen", game: "Time to play" },
      u: { book: "page", audio: "minute", series: "episode", podcast: "episode", game: "hour" },
      at: "{t} · {u} {v}", of: "{t} · {u} {v} of {n}", go: "{t} · pick up where you left off"
    },
    el: {
      t: { book: "Ώρα για διάβασμα", film: "Ώρα για ταινία", series: "Ώρα για σειρά", album: "Ώρα για μουσική",
           podcast: "Ώρα για podcast", game: "Ώρα για παιχνίδι" },
      u: { book: "σελίδα", audio: "λεπτό", series: "επεισόδιο", podcast: "επεισόδιο", game: "ώρα" },
      at: "{t} · {u} {v}", of: "{t} · {u} {v} από {n}", go: "{t} · συνέχισε από εκεί που σταμάτησες"
    }
  };
  // Placeholders filled with a function, so "$&" in a title stays text.
  function fill(tpl, vals) {
    return tpl.replace(/\{([a-z])\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vals, k) ? String(vals[k]) : m; });
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function intOk(v, lo, hi) { return typeof v === "number" && Math.floor(v) === v && v >= lo && v <= hi; }

  function readRem(x) {
    x = x && typeof x === "object" ? x : {};
    return { on: x.on === 1 ? 1 : 0, h: intOk(x.h, 0, 23) ? x.h : REM_HOUR };
  }

  function reminderDue(data, rem, now) {
    rem = readRem(rem);
    if (!rem.on || !data || typeof data !== "object") return null;
    now = now instanceof Date ? now : new Date(now);
    if (now.getHours() < rem.h) return null;
    var today = ymdOf(now);
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var live = {}, now_ = [];
    (Array.isArray(data.items) ? data.items : []).forEach(function (it) {
      if (!it || typeof it !== "object" || typeof it.id !== "string" || !ID_RE.test(it.id) || dead(tombs, it)) return;
      var title = str(it.title, 200);
      if (!title) return;
      live[it.id] = 1;
      if (it.st === "now") now_.push({ it: it, title: title, sess: [] });
    });
    if (!now_.length) return null;
    var byId = {};
    now_.forEach(function (x) { byId[x.it.id] = x; });
    var loggedToday = false;
    (Array.isArray(data.sess) ? data.sess : []).forEach(function (s) {
      if (!s || typeof s !== "object" || typeof s.it !== "string" || !live[s.it] ||
          typeof s.d !== "string" || !YMD_RE.test(s.d) || dead(tombs, s)) return;
      if (s.d === today) loggedToday = true;
      if (byId[s.it]) byId[s.it].sess.push(s);
    });
    if (loggedToday) return null;
    function cmp(a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : ((a.m || 0) - (b.m || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }
    var best = null, bestAt = "";
    now_.forEach(function (x) {
      x.sess.sort(cmp);
      var last = x.sess.length ? x.sess[x.sess.length - 1].d : "";
      var at = last + "|" + String(x.it.m || 0).padStart(15, "0") + "|" + x.it.id;
      if (!best || at > bestAt) { best = x; bestAt = at; }
    });
    var from = 0, v = 0;
    best.sess.forEach(function (s, i) { if (s.k === "s") from = i; });
    best.sess.slice(from).forEach(function (s) { if (s.k === "p" && intOk(s.v, 0, 1e9) && s.v > v) v = s.v; });
    return {
      key: "read-" + today, item: best.it.id, title: best.title, type: best.it.type,
      fmt: best.it.fmt === "a" ? "a" : "", v: v, size: intOk(best.it.size, 0, 1e9) ? best.it.size : 0
    };
  }

  function reminderText(due, lang) {
    var tx = REM_TEXT[lang] || REM_TEXT.en;
    var title = tx.t[due.type] || tx.t.book;
    var unit = tx.u[due.type === "book" && due.fmt === "a" ? "audio" : due.type];
    var tpl = unit && due.v > 0 ? (due.size >= due.v ? tx.of : tx.at) : tx.go;
    var n = function (x) { return Number(x).toLocaleString(lang === "el" ? "el-GR" : "en-GB"); };
    return { title: title, body: fill(tpl, { t: due.title, u: unit || "", v: n(due.v), n: n(due.size) }) };
  }

  function label(k, title, lang) {
    var tx = TEXT[lang] || TEXT.en;
    return fill(tx[k] || tx.d, { t: title });
  }

  var api = { byDay: byDay, label: label, REM_KEY: REM_KEY, readRem: readRem,
              reminderDue: reminderDue, reminderText: reminderText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShelfFeed = api;
})(typeof window !== "undefined" ? window : this);
