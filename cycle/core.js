// ============================================================
// orOS Cycle — core.js (shared prediction, v1.0.0)
// One copy of the next-period estimate, read by every page that
// needs it:
//   - the Cycle app (cycle/index.html loads it before cycle.js)
//   - the shell (index.html → cycleCheckTick while the app is closed)
//   - the Today summary (cycle/today.js, through apps.json "today")
//   - the tests (tests/today-wave4.test.js, through module.exports)
// Pure functions, no DOM, no storage, no language. Read-only.
// An ESTIMATE from the user's own history: next start = last start +
// average cycle length (mean gap between consecutive starts, needs at
// least 2 starts); window = average period length (ended periods
// only, inclusive days, 5 when none has ended yet).
//
// API (window.OrosCycleCore):
//   DAY_MS
//   snap(ts)                 local midnight of ts, or null
//   avgCycleLen(periods)     days, or null with fewer than 2 starts
//   avgPeriodLen(periods)    days, or null with no ended period
//   nextPrediction(periods)  { start, end, avg } (ms) or null
//   dueIn(periods, todayMs)  { ymd, daysLeft } of the predicted start
//                            when it is at most 2 days away or past;
//                            else null (the reminder rule)
//   ymdOf(ts)                "YYYY-MM-DD" in local time
// Wave 34 (flow per day, BBT + mucus, fertile window — see below):
//   parseBbt(str) · validFlow / validBbt / validCm / validExtra
//   dayFlow(day, period) · periodFlow(period, days)
//   tempShift(obs) · mucusPeak(obs, today) · fertility(start, obs, pastFirst, today)
//   EXTRA, mergeExtras, ownExtras, putExtras, extraMax (day sync helpers)
// periods = [{ start: ms, end: ms | null, … }] (oros-cycle-data)
// ============================================================
(function (root) {
  "use strict";
  var DAY_MS = 24 * 60 * 60 * 1000;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function snap(ts) {
    if (typeof ts !== "number" || !isFinite(ts)) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  // valid starts, snapped to local midnight, oldest first
  function starts(periods) {
    var out = [];
    (Array.isArray(periods) ? periods : []).forEach(function (p) {
      if (!p) return;
      var s = snap(p.start);
      if (s !== null) out.push(s);
    });
    return out.sort(function (a, b) { return a - b; });
  }
  function avgCycleLen(periods) {
    var st = starts(periods);
    if (st.length < 2) return null;                     // honesty over guessing
    var sum = 0;
    for (var i = 1; i < st.length; i++) sum += Math.round((st[i] - st[i - 1]) / DAY_MS);
    return Math.round(sum / (st.length - 1));
  }
  function avgPeriodLen(periods) {
    var sum = 0, n = 0;
    (Array.isArray(periods) ? periods : []).forEach(function (p) {
      if (p && typeof p.end === "number" && isFinite(p.end) &&
          typeof p.start === "number" && p.end >= p.start) {
        sum += Math.round((p.end - p.start) / DAY_MS) + 1;   // inclusive
        n++;
      }
    });
    return n ? Math.round(sum / n) : null;
  }
  function nextPrediction(periods) {
    var avg = avgCycleLen(periods);
    if (avg === null) return null;
    var st = starts(periods), last = st[st.length - 1];
    var len = avgPeriodLen(periods);
    if (len === null) len = 5;                          // no ended period yet
    var start = last + avg * DAY_MS;
    return { start: start, end: start + (len - 1) * DAY_MS, avg: avg };
  }
  function dueIn(periods, todayMs) {
    var pr = nextPrediction(periods);
    if (!pr) return null;
    var daysLeft = Math.ceil((pr.start - todayMs) / DAY_MS);
    if (daysLeft > 2) return null;
    return { ymd: ymdOf(pr.start), daysLeft: daysLeft };
  }

  // ---------- Wave 34: flow per day, BBT + mucus, fertile window ----------
  // Day records may carry (all optional, absent when not logged):
  //   fl  1|2|3   flow of THAT day (light / normal / heavy); a day
  //               inside a period without its own fl shows the
  //               period's flow (the old, whole-period value), so
  //               old data reads exactly as before
  //   bbt 3400–4300  basal body temperature, hundredths of °C
  //   cm  1|2|3|4 cervical mucus: dry · moist · creamy / sticky ·
  //               egg white / stretchy (the best quality of the day)
  // The fertile-window estimate is the symptothermal double check
  // (Sensiplan-style), from the person's own log only:
  //   temperature: the first reading higher than each of the 6 before
  //     it (coverline = the highest of those 6), then 3 higher readings
  //     on consecutive days, the 3rd at least 0.20 °C over the
  //     coverline — else a 4th higher one;
  //   mucus: the peak = the last day of the best quality seen before
  //     it drops; confirmed on the evening of the 3rd day after it;
  //   end of the fertile window = the LATER of the two confirmations
  //     (temperature alone when no mucus was logged in that cycle);
  //   start = cycle day 6 (first-5-days rule), or with 12+ cycles of
  //     history the earliest first-higher-temperature day minus 8,
  //     or earlier when mucus is felt or seen first.
  // An ESTIMATE for body literacy, NOT contraception: the UI says so.
  var BBT_MIN = 3400, BBT_MAX = 4300;
  function validFlow(v) { return v === 1 || v === 2 || v === 3; }
  function validBbt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= BBT_MIN && v <= BBT_MAX; }
  function validCm(v) { return v === 1 || v === 2 || v === 3 || v === 4; }

  // "36,45" / "36.45" (°C) or "97.6" (°F, converted) → hundredths of °C
  function parseBbt(str) {
    var s = String(str === null || str === undefined ? "" : str).trim().replace(",", ".");
    if (!/^\d{2,3}(\.\d{1,3})?$/.test(s)) return null;
    var v = Number(s);
    if (v >= 90 && v <= 110) v = (v - 32) * 5 / 9;          // Fahrenheit
    var h = Math.round(v * 100);
    return validBbt(h) ? h : null;
  }

  // the flow a day shows: its own, else its period's
  function dayFlow(day, period) {
    if (day && validFlow(day.fl)) return day.fl;
    return period && validFlow(period.flow) ? period.flow : 0;
  }
  // the flow a period bar shows: the most frequent day flow among its
  // logged days (a tie → the heavier), else the period's own value
  function periodFlow(period, days) {
    if (!period) return 0;
    var end = typeof period.end === "number" ? period.end : Infinity, n = [0, 0, 0, 0], any = false;
    (Array.isArray(days) ? days : []).forEach(function (d) {
      if (!d || typeof d.day !== "number" || d.day < period.start || d.day > end || !validFlow(d.fl)) return;
      n[d.fl]++;
      any = true;
    });
    if (!any) return validFlow(period.flow) ? period.flow : 2;
    var best = 1;
    for (var f = 2; f <= 3; f++) if (n[f] >= n[best]) best = f;
    return best;
  }

  // whole-day arithmetic on "YYYY-MM-DD" (UTC: no DST surprises)
  function kNum(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || "");
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
  }
  function kOf(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  // obs: [{ k: "YYYY-MM-DD", bbt?, cm? }] of ONE cycle (any order)
  function sortedObs(obs) {
    return (Array.isArray(obs) ? obs : []).filter(function (o) { return o && kNum(o.k) !== null; })
      .slice().sort(function (a, b) { return kNum(a.k) - kNum(b.k); });
  }
  function tempShift(obs) {
    var r = sortedObs(obs).filter(function (o) { return validBbt(o.bbt); });
    for (var i = 6; i < r.length; i++) {
      var cover = 0;
      for (var j = i - 6; j < i; j++) cover = Math.max(cover, r[j].bbt);
      if (r[i].bbt <= cover) continue;
      var d0 = kNum(r[i].k), ok = true;
      for (var s = 1; s <= 2 && ok; s++) {
        var x = r[i + s];
        ok = !!x && kNum(x.k) === d0 + s && x.bbt > cover;
      }
      if (!ok) continue;
      if (r[i + 2].bbt >= cover + 20) return { first: r[i].k, cover: cover, confirm: r[i + 2].k };
      var x4 = r[i + 3];
      if (x4 && kNum(x4.k) === d0 + 3 && x4.bbt > cover) return { first: r[i].k, cover: cover, confirm: x4.k };
    }
    return null;
  }
  function mucusPeak(obs, today) {
    var r = sortedObs(obs).filter(function (o) { return validCm(o.cm); });
    var top = 0;
    r.forEach(function (o) { top = Math.max(top, o.cm); });
    if (top < 3) return null;                     // no creamy / egg-white mucus: no peak to find
    var peak = null;
    for (var i = 0; i < r.length; i++) {
      if (r[i].cm !== top) continue;
      var nx = r[i + 1];
      if (nx && kNum(nx.k) === kNum(r[i].k) + 1 && nx.cm < top) peak = r[i];
    }
    if (!peak) return null;
    var p = kNum(peak.k);
    var back = r.some(function (o) { var n = kNum(o.k); return n > p && n <= p + 3 && o.cm >= top; });
    if (back) return null;                        // quality came back: not the peak yet
    var conf = p + 3, t = kNum(today);
    return { peak: peak.k, confirm: t !== null && t >= conf ? kOf(conf) : null };
  }

  // cycleStart "YYYY-MM-DD"; obs of that cycle; pastFirst = cycle-day
  // numbers (1 = first period day) of the first higher temperature in
  // earlier cycles; today "YYYY-MM-DD".
  function fertility(cycleStart, obs, pastFirst, today) {
    var c0 = kNum(cycleStart);
    if (c0 === null) return null;
    var list = sortedObs(obs).filter(function (o) { return kNum(o.k) >= c0; });
    var past = (Array.isArray(pastFirst) ? pastFirst : []).filter(function (n) { return typeof n === "number" && n >= 1 && n <= 60; });
    var startDay = 6, rule = "5";
    if (past.length >= 12) { startDay = Math.max(1, Math.min.apply(null, past) - 8); rule = "m8"; }
    var start = c0 + startDay - 1;
    var firstMucus = null;
    list.forEach(function (o) { if (firstMucus === null && validCm(o.cm) && o.cm >= 2) firstMucus = kNum(o.k); });
    if (firstMucus !== null && firstMucus < start) { start = firstMucus; rule = "cm"; }
    var temp = tempShift(list), pk = mucusPeak(list, today);
    var hasMucus = list.some(function (o) { return validCm(o.cm); });
    var hasTemp = list.some(function (o) { return validBbt(o.bbt); });
    var end = null;
    if (temp && (!hasMucus || (pk && pk.confirm))) {
      end = kNum(temp.confirm);
      if (pk && pk.confirm) end = Math.max(end, kNum(pk.confirm));
    }
    return {
      start: kOf(start), startRule: rule, end: end === null ? null : kOf(end),
      shift: temp ? temp.first : null, cover: temp ? temp.cover : null, tempConfirm: temp ? temp.confirm : null,
      peak: pk ? pk.peak : null, peakConfirm: pk ? pk.confirm : null,
      method: hasMucus && hasTemp ? "st" : (hasTemp ? "t" : (hasMucus ? "m" : "")),
      shiftDay: temp ? kNum(temp.first) - c0 + 1 : null
    };
  }

  // ---- sync of the new day fields (used by cycle.js mergeDay / canonDay) ----
  // Each extra field has its own stamp fm.<k> (CY-3 style). A day
  // without usable field stamps speaks with its mtime for every field.
  // A cleared value keeps its stamp (so the clear wins over an older
  // value), the value itself is then absent.
  var EXTRA = ["fl", "bbt", "cm"];
  function validExtra(k, v) { return k === "fl" ? validFlow(v) : (k === "bbt" ? validBbt(v) : validCm(v)); }
  function extraStamp(d, fmOk, k) {
    if (!fmOk) return (d && d.mtime) || 0;
    var s = d && d.fm && d.fm[k];
    return typeof s === "number" && isFinite(s) ? s : 0;
  }
  function jsonGe(a, b) { return JSON.stringify(a === undefined ? null : a) >= JSON.stringify(b === undefined ? null : b); }
  // → { k: { v: value | undefined, s: stamp } } for the three fields
  function mergeExtras(x, fx, y, fy) {
    var out = {};
    EXTRA.forEach(function (k) {
      var tx = extraStamp(x, fx, k), ty = extraStamp(y, fy, k);
      var vx = x && validExtra(k, x[k]) ? x[k] : undefined, vy = y && validExtra(k, y[k]) ? y[k] : undefined;
      var v = tx !== ty ? (tx > ty ? vx : vy) : (jsonGe(vx, vy) ? vx : vy);
      out[k] = { v: v, s: Math.max(tx, ty) };
    });
    return out;
  }
  // the extras of ONE day as they stand (for canonDay / touchDay)
  function ownExtras(d, fmOk) {
    var out = {};
    EXTRA.forEach(function (k) {
      var v = d && validExtra(k, d[k]) ? d[k] : undefined;
      var hasStamp = !!(d && d.fm && typeof d.fm[k] === "number");
      out[k] = { v: v, s: (v !== undefined || hasStamp) ? extraStamp(d, fmOk, k) : 0 };
    });
    return out;
  }
  // write extras into a canonical day object: values after `note`,
  // stamps after fm.note — only what exists, so a day that never had
  // them keeps its bytes
  function putExtras(o, ex) {
    EXTRA.forEach(function (k) {
      if (!ex[k]) return;
      if (ex[k].v !== undefined) o[k] = ex[k].v;
      if (ex[k].s > 0) o.fm[k] = ex[k].s;
    });
    return o;
  }
  function extraMax(fm) {
    var m = 0;
    EXTRA.forEach(function (k) { if (fm && typeof fm[k] === "number" && fm[k] > m) m = fm[k]; });
    return m;
  }

  var API = { DAY_MS: DAY_MS, snap: snap, avgCycleLen: avgCycleLen, avgPeriodLen: avgPeriodLen, validExtra: validExtra,
              EXTRA: EXTRA, mergeExtras: mergeExtras, ownExtras: ownExtras, putExtras: putExtras, extraMax: extraMax,
              nextPrediction: nextPrediction, dueIn: dueIn, ymdOf: ymdOf,
              BBT_MIN: BBT_MIN, BBT_MAX: BBT_MAX, validFlow: validFlow, validBbt: validBbt, validCm: validCm,
              parseBbt: parseBbt, dayFlow: dayFlow, periodFlow: periodFlow,
              tempShift: tempShift, mucusPeak: mucusPeak, fertility: fertility };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCycleCore = API;
})(typeof window !== "undefined" ? window : globalThis);
