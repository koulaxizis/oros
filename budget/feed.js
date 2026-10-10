// ============================================================
// orOS Budget — feed.js (read-only Calendar feed, v1.0.0)
// The Calendar (calendar/index.html loads this file) shows the
// upcoming occurrences of Budget's recurring entries: rent on the
// 1st, salary on the 25th, a yearly insurance. Nothing is stored
// or synced by it; it only reads Budget's own blob.
//
// The date rules MUST match budget.js occurrences() (monthly and
// yearly keep the day of the first date, clamped to the month's
// last day; weekly = every 7 days from the first date; both ends
// inclusive). tests/budget-feed.test.js checks the two agree, and
// that SEED_NAMES here equals the one in budget.js.
//
// API (window.OrosBudgetFeed):
//   occurrences(rec, from, to) → ["YYYY-MM-DD", …]
//   rowsOn(data, ymd, today, lang) → [{ id, k, a, name, cur }]
//     id = recurring entry id, k = "o" expense | "i" income,
//     a = cents, name = note or category name, cur = currency.
//     Days before `today` give nothing (those are real entries in
//     Budget by then). Deleted recurring entries (tombstone
//     "rec:<id>") and a deleted occurrence ("tx:<occurrence id>")
//     are left out.
// Data (synced slice "budget", key oros-budget-data):
//   rec: [{ id, m, k, a, c, n, f ("m"|"w"|"y"), s, e }],
//   cats: [{ id, k, name, … }], set: { cur }, tombs: { key: ms }
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var REC_ID_RE = /^[a-z0-9]{1,24}$/;
  var CUR_RE = /^[A-Z]{3}$/;
  var MAX_CENTS = 100000000000;
  var FREQS = { m: 1, w: 1, y: 1 };
  var KINDS = { o: 1, i: 1 };

  var SEED_NAMES = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home",
          "o-trans": "Transport", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing",
          "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance",
          "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι",
          "o-trans": "Μεταφορές", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα",
          "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα",
          "i-gift": "Δώρα", "i-other": "Άλλα" }
  };

  // ---------- dates (same helpers as budget.js) ----------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function parseYmd(s) {
    var x = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!x) return null;
    var y = +x[1], m = +x[2], d = +x[3];
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  function ymdOf(y, m, d) { return y + "-" + pad2(m) + "-" + pad2(d); }
  function utcMs(ymd) { var p = parseYmd(ymd); return Date.UTC(p.y, p.m - 1, p.d); }
  function ymdUTC(ms) { var x = new Date(ms); return ymdOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }
  function mkOf(ymd) { return ymd.slice(0, 7); }
  function mkAdd(mk, n) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + pad2(m + 1);
  }

  function occurrences(rec, from, to) {
    var out = [], s = parseYmd(rec.s);
    if (!s) return out;
    var end = rec.e && rec.e < to ? rec.e : to;
    if (from < rec.s) from = rec.s;
    if (from > end) return out;
    var guard = 0;
    if (rec.f === "w") {
      var t0 = utcMs(rec.s), k = Math.max(0, Math.floor((utcMs(from) - t0) / 604800000));
      for (; guard < 2000; k++, guard++) {
        var y = ymdUTC(t0 + k * 604800000);
        if (y > end) break;
        if (y >= from) out.push(y);
      }
    } else if (rec.f === "y") {
      for (var yy = +from.slice(0, 4); guard < 300; yy++, guard++) {
        var oy = ymdOf(yy, s.m, Math.min(s.d, daysIn(yy, s.m)));
        if (oy > end) break;
        if (oy >= from) out.push(oy);
      }
    } else {
      var mk = mkOf(from);
      for (; guard < 3000; mk = mkAdd(mk, 1), guard++) {
        var Y = +mk.slice(0, 4), M = +mk.slice(5, 7);
        var om = ymdOf(Y, M, Math.min(s.d, daysIn(Y, M)));
        if (om > end) break;
        if (om >= from) out.push(om);
      }
    }
    return out;
  }
  function recTxId(recId, ymd) { return "r" + recId + "-" + ymd.replace(/-/g, ""); }

  // ---------- rows ----------
  function text(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
  }
  function okRec(r) {
    return r && typeof r === "object" && typeof r.id === "string" && REC_ID_RE.test(r.id) &&
      KINDS[r.k] && FREQS[r.f] && typeof r.a === "number" && r.a === Math.floor(r.a) &&
      r.a > 0 && r.a <= MAX_CENTS && parseYmd(r.s) &&
      (!r.e || (parseYmd(r.e) && r.e >= r.s));
  }
  function catNameOf(data, id, lang) {
    if (typeof id !== "string" || !id) return "";
    var cats = Array.isArray(data.cats) ? data.cats : [];
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (c && c.id === id && typeof c.name === "string" && c.name.trim()) return text(c.name, 30);
    }
    return (SEED_NAMES[lang] || SEED_NAMES.en)[id] || "";
  }

  function rowsOn(data, ymd, today, lang) {
    if (!data || typeof data !== "object" || !Array.isArray(data.rec) || !parseYmd(ymd)) return [];
    if (typeof today === "string" && ymd < today) return [];
    var tombs = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var cur = data.set && typeof data.set.cur === "string" && CUR_RE.test(data.set.cur) ? data.set.cur : "EUR";
    var out = [];
    data.rec.forEach(function (r) {
      if (!okRec(r) || Object.prototype.hasOwnProperty.call(tombs, "rec:" + r.id)) return;
      if (!occurrences(r, ymd, ymd).length) return;
      if (Object.prototype.hasOwnProperty.call(tombs, "tx:" + recTxId(r.id, ymd))) return;
      out.push({ id: r.id, k: r.k, a: r.a, name: text(r.n, 140) || catNameOf(data, r.c, lang), cur: cur });
    });
    return out;
  }

  var api = { occurrences: occurrences, rowsOn: rowsOn, SEED_NAMES: SEED_NAMES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosBudgetFeed = api;
})(typeof window !== "undefined" ? window : this);
