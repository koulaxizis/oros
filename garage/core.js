// ============================================================
// orOS Garage — core.js (shared logic, v1.0.0)
// One file holds the vehicle math, so the app, the shell's
// reminder engine and the Calendar feed can never disagree:
//   - the Garage app (garage/index.html)
//   - the shell (index.html → garageCheckTick, works while the
//     app is closed; wired in the release commit)
//   - the Calendar "Garage" feed (calendar/index.html loads it)
// Pure functions, no DOM, no network. Dates are local calendar
// days "YYYY-MM-DD"; day arithmetic runs on whole UTC days.
// Money is integer cents, quantities integer thousandths (mL or
// Wh), distances integer km: totals never drift.
//
// API (window.OrosGarageCore):
//   TYPES, FUELS, ITEMS, RENEWALS, COST_CATS, DATA_VER, ID_RE
//   ymdOf, isYmd, dayNum, ymdFromDay, addDays, addMonths
//   cleanText, parseNum(str, lang)
//   norm* (strict: invalid rows are dropped), merge(A, B, nowMs)
//   hasFuel(v), itemsFor(type), itemName(item, lang), defaultPlans(type, fuel)
//   readings(data, vid), currentKm(data, vid), kmPerDay(data, vid, today)
//   consumption(data, vid, energy) → { segs, avg, last, dist, q }
//   lastService(data, vid, item) → { d, km, id } | null
//   planStatus(plan, data, today) · renewalStatus(r, today)
//   tyreStatus(t, data, today, prefs)
//   alerts(data, today, prefs) → [alert] (most urgent first)
//   toNotify(alerts, notified) → alerts not yet announced at that level
//   alertLine(alert, data, lang) → one line of the grouped reminder
//   renewal(r) → { costId, next } (the "Renewed" action, deterministic)
//   costs(data, vid, from, to) → { fuel, service, other, total }
//   monthly(data, vid, months, today) → [{ ym, fuel, service, other }]
//   csvRows(data, names) → rows · csvCell(v)
//   readPrefs(raw) → { remind, unit, tyreAge, tyreTread }
// Data (synced slice "garage", key oros-garage-data):
//   { ver: 1, vehicles, fuel, service, plans, tyres, renewals,
//     costs, odo: [row…] each sorted by id, settings: { m, cur },
//     tombs: { id: deletedAt } }
// Nothing derived is stored (consumption, current km, next
// service, "expires in"): two devices can never disagree on it.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_MS = 86400000;
  var NAME_LEN = 40, SHORT_LEN = 40, NOTES_LEN = 500, PLATE_LEN = 16;
  var MAX_VEHICLES = 30;
  var MAX_ROWS = 20000;        // per list: a safety net, never reached by hand
  var TOMB_DAYS = 365;
  var KM_MAX = 9999999;
  var C_MAX = 99999999;        // cents: just under a million
  var Q_MAX = 9999999;         // thousandths: 9 999 L / kWh in one go
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];

  // ---------- Catalogues (language-free ids) ----------
  // cls: m = motor vehicle, t = two-wheeler with engine, b = boat,
  // p = pedal / light electric (bicycle, e-bike, e-scooter)
  var TYPES = {
    car:      { em: "🚗", cls: "m", fuel: "petrol", motor: 1 },
    moto:     { em: "🏍️", cls: "t", fuel: "petrol", motor: 1 },
    scooter:  { em: "🛵", cls: "t", fuel: "petrol", motor: 1 },
    van:      { em: "🚐", cls: "m", fuel: "diesel", motor: 1 },
    truck:    { em: "🚚", cls: "m", fuel: "diesel", motor: 1 },
    camper:   { em: "🚙", cls: "m", fuel: "diesel", motor: 1 },
    tractor:  { em: "🚜", cls: "m", fuel: "diesel", motor: 1 },
    boat:     { em: "🚤", cls: "b", fuel: "petrol", motor: 1 },
    bike:     { em: "🚲", cls: "p", fuel: "none",   motor: 0 },
    ebike:    { em: "🚲", cls: "p", fuel: "none",   motor: 0 },
    escooter: { em: "🛴", cls: "p", fuel: "none",   motor: 0 },
    other:    { em: "🚘", cls: "m", fuel: "petrol", motor: 1 }
  };
  var TYPE_IDS = Object.keys(TYPES);
  // energy: f = liquid / gas fuel (litres; CNG in kg), e = electricity (kWh)
  var FUELS = {
    petrol: { e: ["f"] }, diesel: { e: ["f"] }, lpg: { e: ["f"] }, cng: { e: ["f"] },
    hybrid: { e: ["f"] }, phev: { e: ["f", "e"] }, ev: { e: ["e"] }, none: { e: [] }
  };
  var FUEL_IDS = Object.keys(FUELS);

  // Service items. for: the classes they apply to. km / mo: the
  // usual interval offered when a plan is created (0 = not by that
  // measure). Suggestions only — the manual of each vehicle wins.
  var ITEMS = {
    oil:      { for: "mtb", km: 10000, mo: 12 },
    ofilter:  { for: "mtb", km: 10000, mo: 12 },
    afilter:  { for: "mt",  km: 20000, mo: 24 },
    cabin:    { for: "m",   km: 15000, mo: 12 },
    ffilter:  { for: "m",   km: 40000, mo: 48 },
    plugs:    { for: "mtb", km: 30000, mo: 36 },
    brakes:   { for: "mtp", km: 30000, mo: 0 },
    timing:   { for: "m",   km: 100000, mo: 60 },
    belt:     { for: "t",   km: 20000, mo: 24 },
    chain:    { for: "tp",  km: 15000, mo: 0 },
    lube:     { for: "tp",  km: 500,   mo: 1 },
    battery:  { for: "mtbp", km: 0,    mo: 48 },
    coolant:  { for: "mtb", km: 60000, mo: 48 },
    gearbox:  { for: "m",   km: 60000, mo: 0 },
    ac:       { for: "m",   km: 0,     mo: 24 },
    rotation: { for: "m",   km: 10000, mo: 0 },
    tyres:    { for: "tp",  km: 5000,  mo: 0 },
    wipers:   { for: "m",   km: 0,     mo: 12 },
    impeller: { for: "b",   km: 0,     mo: 24 },
    anodes:   { for: "b",   km: 0,     mo: 12 },
    antifoul: { for: "b",   km: 0,     mo: 12 },
    cables:   { for: "p",   km: 5000,  mo: 24 },
    gears:    { for: "p",   km: 3000,  mo: 12 },
    tune:     { for: "p",   km: 0,     mo: 12 },
    general:  { for: "mtbp", km: 15000, mo: 12 },
    other:    { for: "mtbp", km: 0,    mo: 0 }
  };
  var ITEM_IDS = Object.keys(ITEMS);
  // Item names [en, el]: here, so the app and the Calendar feed share them.
  var ITEM_NAMES = {
    oil: ["Oil change", "Λάδια"],
    ofilter: ["Oil filter", "Φίλτρο λαδιού"],
    afilter: ["Air filter", "Φίλτρο αέρα"],
    cabin: ["Cabin filter", "Φίλτρο καμπίνας"],
    ffilter: ["Fuel filter", "Φίλτρο καυσίμου"],
    plugs: ["Spark plugs", "Μπουζί"],
    brakes: ["Brakes", "Φρένα"],
    timing: ["Timing belt", "Ιμάντας χρονισμού"],
    belt: ["Drive belt", "Ιμάντας κίνησης"],
    chain: ["Chain", "Αλυσίδα"],
    lube: ["Chain lube", "Λίπανση αλυσίδας"],
    battery: ["Battery", "Μπαταρία"],
    coolant: ["Coolant", "Αντιψυκτικό"],
    gearbox: ["Gearbox oil", "Λάδι κιβωτίου"],
    ac: ["Air conditioning", "Κλιματισμός"],
    rotation: ["Tyre rotation", "Εναλλαγή ελαστικών"],
    tyres: ["Tyres / tubes", "Λάστιχα / σαμπρέλες"],
    wipers: ["Wipers", "Υαλοκαθαριστήρες"],
    impeller: ["Impeller", "Φτερωτή"],
    anodes: ["Anodes", "Ανόδια"],
    antifoul: ["Antifouling", "Υφαλόχρωμα"],
    cables: ["Cables", "Ντίζες"],
    gears: ["Gears", "Ταχύτητες"],
    tune: ["Tune-up", "Γενικός έλεγχος"],
    general: ["General service", "Γενικό σέρβις"],
    other: ["Other", "Άλλο"]
  };
  function itemName(it, lang) { var n = ITEM_NAMES[it]; return n ? n[lang === "el" ? 1 : 0] : String(it); }
  // Plans a new vehicle starts with, per class (all editable / removable)
  var DEFAULT_PLANS = {
    m: ["oil", "afilter", "cabin", "brakes", "timing", "battery"],
    t: ["oil", "chain", "lube", "brakes", "battery"],
    b: ["oil", "impeller", "anodes", "antifoul"],
    p: ["lube", "chain", "brakes", "tyres", "tune"]
  };

  // Renewals: every = usual months between expiries (0 = one-off).
  var RENEWALS = {
    kteo:  { every: 24 }, ins: { every: 12 }, tax: { every: 12 }, kek: { every: 12 },
    road:  { every: 12 }, lic: { every: 0 },  other: { every: 12 }
  };
  var RENEWAL_IDS = Object.keys(RENEWALS);
  var RENEWAL_NAMES = {
    kteo: ["Roadworthiness test (KTEO)", "ΚΤΕΟ"],
    ins: ["Insurance", "Ασφάλεια"],
    tax: ["Road tax", "Τέλη κυκλοφορίας"],
    kek: ["Emissions card", "Κάρτα καυσαερίων"],
    road: ["Roadside assistance", "Οδική βοήθεια"],
    lic: ["Driving licence", "Δίπλωμα οδήγησης"],
    other: ["Other", "Άλλο"]
  };
  function renewalName(kind, lang) { var n = RENEWAL_NAMES[kind]; return n ? n[lang === "el" ? 1 : 0] : String(kind); }
  var WARN_DEFAULT = [30, 7, 1];
  var COST_CATS = ["toll", "park", "wash", "fine", "parts", "acc", "kteo", "ins", "tax", "kek", "road", "lic", "rent", "other"];

  // ---------- Dates ----------
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function isYmd(s) {
    if (typeof s !== "string") return false;
    var m = YMD_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || da < 1) return false;
    return da <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  function dayNum(ymd) {
    var m = YMD_RE.exec(ymd);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }
  function ymdFromDay(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
  }
  function addDays(ymd, n) { return ymdFromDay(dayNum(ymd) + n); }
  // Calendar months; the day is clamped to the month's end
  // (31 Jan + 1 month = 28/29 Feb).
  function addMonths(ymd, n) {
    var y = +ymd.slice(0, 4), mo = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10);
    y += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + "-" + p2(mo + 1) + "-" + p2(Math.min(d, last));
  }

  // ---------- Helpers ----------
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : null; }
  function cleanText(s, max, multiline) {
    if (typeof s !== "string") return "";
    s = s.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ");
    s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
                  : s.replace(/\s+/g, " ").trim();
    return s.slice(0, max);
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // "1.234,5" · "1,234.5" · "42,3" · "42.3" · "1 234" → number, or
  // null. With both separators the LAST one is the decimal mark.
  // With only one kind: a comma is decimal; a dot is decimal too,
  // except in Greek where "1.234" (groups of exactly 3) is thousands.
  function parseNum(str, lang) {
    if (typeof str === "number") return isFinite(str) ? str : null;
    if (typeof str !== "string") return null;
    var s = str.replace(/[\s  ']/g, "");
    if (!s) return null;
    if (!/^-?[0-9.,]+$/.test(s)) return null;
    var lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
      var dec = lc > ld ? "," : ".", grp = dec === "," ? "." : ",";
      s = s.split(grp).join("");
      if (s.indexOf(dec) !== s.lastIndexOf(dec)) return null;
      s = s.replace(dec, ".");
    } else if (lc >= 0) {
      if (s.indexOf(",") !== lc) {
        if (!/^-?\d{1,3}(,\d{3})+$/.test(s)) return null;
        s = s.split(",").join("");
      } else s = s.replace(",", ".");
    } else if (ld >= 0) {
      if (s.indexOf(".") !== ld || (lang === "el" && /^-?\d{1,3}(\.\d{3})+$/.test(s))) {
        if (!/^-?\d{1,3}(\.\d{3})+$/.test(s)) return null;
        s = s.split(".").join("");
      }
    }
    if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // ---------- Normalizers (strict: invalid rows are DROPPED) ----------
  function base(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }
  function vref(x) { return typeof x.v === "string" && ID_RE.test(x.v); }
  function optKm(v) { return v === null || v === undefined ? null : clampInt(v, 0, KM_MAX); }
  function cents(v) { return clampInt(v, 0, C_MAX) || 0; }

  function normVehicle(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name || !has(TYPES, x.type)) return null;
    var fuel = has(FUELS, x.fuel) ? x.fuel : TYPES[x.type].fuel;
    return {
      id: x.id, m: x.m, name: name, type: x.type, fuel: fuel,
      make: cleanText(x.make, SHORT_LEN, false), model: cleanText(x.model, SHORT_LEN, false),
      year: clampInt(x.year, 1900, 2200) || 0,
      plate: cleanText(x.plate, PLATE_LEN, false),
      tank: clampInt(x.tank, 0, 999) || 0,
      col: clampInt(x.col, 0, 7) || 0,
      arch: x.arch === 1 ? 1 : 0,
      notes: cleanText(x.notes, NOTES_LEN, true)
    };
  }
  // fuel / charge: q thousandths (mL, Wh); c total cents; full 1|0;
  // mis 1 = a fill before this one was not logged (breaks the chain)
  function normFuel(x) {
    if (!base(x) || !vref(x) || !isYmd(x.d)) return null;
    var km = clampInt(x.km, 0, KM_MAX), q = clampInt(x.q, 1, Q_MAX);
    if (km === null || q === null) return null;
    return {
      id: x.id, m: x.m, v: x.v, d: x.d, km: km, q: q, c: cents(x.c),
      e: x.e === "e" ? "e" : "f", full: x.full === 0 ? 0 : 1, mis: x.mis === 1 ? 1 : 0,
      st: cleanText(x.st, SHORT_LEN, false), n: cleanText(x.n, NOTES_LEN, true),
      bud: x.bud === 1 ? 1 : 0
    };
  }
  function normService(x) {
    if (!base(x) || !vref(x) || !isYmd(x.d) || !Array.isArray(x.items)) return null;
    var items = [];
    x.items.forEach(function (it) { if (has(ITEMS, it) && items.indexOf(it) < 0) items.push(it); });
    if (!items.length) return null;
    items.sort(function (a, b) { return ITEM_IDS.indexOf(a) - ITEM_IDS.indexOf(b); });
    return {
      id: x.id, m: x.m, v: x.v, d: x.d, km: optKm(x.km), items: items, c: cents(x.c),
      shop: cleanText(x.shop, SHORT_LEN, false), n: cleanText(x.n, NOTES_LEN, true),
      bud: x.bud === 1 ? 1 : 0
    };
  }
  // A service plan: item every km and/or every mo months (at least
  // one), counted from the newest service holding the item, else
  // from the plan's start (sd, skm).
  function normPlan(x) {
    if (!base(x) || !vref(x) || !has(ITEMS, x.item) || !isYmd(x.sd)) return null;
    var km = clampInt(x.km, 0, 1000000) || 0, mo = clampInt(x.mo, 0, 240) || 0;
    if (!km && !mo) return null;
    return { id: x.id, m: x.m, v: x.v, item: x.item, km: km, mo: mo, sd: x.sd, skm: optKm(x.skm),
             label: cleanText(x.label, SHORT_LEN, false) };
  }
  // A tyre set. km = km run in earlier mounted periods; on = mounted
  // now, from odometer okm. dot = "WWYY" (week + year of make).
  function normTyre(x) {
    if (!base(x) || !vref(x)) return null;
    var label = cleanText(x.label, SHORT_LEN, false);
    if (!label) return null;
    var dot = typeof x.dot === "string" && /^(0[1-9]|[1-4]\d|5[0-3])\d{2}$/.test(x.dot) ? x.dot : "";
    var on = x.on === 1 ? 1 : 0;
    return {
      id: x.id, m: x.m, v: x.v, label: label,
      season: x.season === "w" || x.season === "a" ? x.season : "s",
      size: cleanText(x.size, 24, false), brand: cleanText(x.brand, SHORT_LEN, false),
      dot: dot, tread: clampInt(x.tread, 0, 200) || 0,      // tenths of a mm
      km: clampInt(x.km, 0, KM_MAX) || 0,
      on: on, okm: on ? optKm(x.okm) : null,
      n: cleanText(x.n, NOTES_LEN, true)
    };
  }
  function normRenewal(x) {
    if (!base(x) || !vref(x) || !has(RENEWALS, x.kind) || !isYmd(x.exp)) return null;
    var warn = [];
    if (Array.isArray(x.warn)) x.warn.forEach(function (w) {
      if (clampInt(w, 0, 365) !== null && warn.indexOf(w) < 0) warn.push(w);
    });
    if (!Array.isArray(x.warn)) warn = WARN_DEFAULT.slice();
    warn.sort(function (a, b) { return b - a; });
    return {
      id: x.id, m: x.m, v: x.v, kind: x.kind, exp: x.exp,
      every: clampInt(x.every, 0, 240) || 0,
      label: cleanText(x.label, SHORT_LEN, false), c: cents(x.c),
      prov: cleanText(x.prov, SHORT_LEN, false), ref: cleanText(x.ref, SHORT_LEN, false),
      warn: warn.slice(0, 4), n: cleanText(x.n, NOTES_LEN, true)
    };
  }
  function normCost(x) {
    if (!base(x) || !vref(x) || !isYmd(x.d) || COST_CATS.indexOf(x.cat) < 0) return null;
    var c = clampInt(x.c, 1, C_MAX);
    if (c === null) return null;
    return { id: x.id, m: x.m, v: x.v, d: x.d, cat: x.cat, c: c, km: optKm(x.km),
             n: cleanText(x.n, NOTES_LEN, true), bud: x.bud === 1 ? 1 : 0 };
  }
  function normOdo(x) {
    if (!base(x) || !vref(x) || !isYmd(x.d)) return null;
    var km = clampInt(x.km, 0, KM_MAX);
    if (km === null) return null;
    return { id: x.id, m: x.m, v: x.v, d: x.d, km: km };
  }
  function normSettings(x) {
    var s = x && typeof x === "object" ? x : {};
    return { m: isInt(s.m) && s.m >= 0 ? s.m : 0, cur: CURRENCIES.indexOf(s.cur) >= 0 ? s.cur : "EUR" };
  }

  var LISTS = {
    fuel: normFuel, service: normService, plans: normPlan, tyres: normTyre,
    renewals: normRenewal, costs: normCost, odo: normOdo
  };
  var LIST_KEYS = Object.keys(LISTS);

  function canon(v) { return JSON.stringify(v); }
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }

  // Symmetric, canonical merge (R5, R26). Every list LWW per id;
  // tombstones max-merged; a tombstone at or after a row's m hides
  // it, a newer edit resurrects (R17). Rows of a vehicle that is not
  // alive drop. Settings LWW by m. Tombstones expire after a year
  // (the same rule everywhere, so nothing returns with a pull).
  function merge(A, B, nowMs) {
    // own properties only: an inherited key is never data
    function own(o) {
      var r = {};
      if (o && typeof o === "object") Object.keys(o).forEach(function (k) { r[k] = o[k]; });
      return r;
    }
    var a = own(A), b = own(B);
    var now = isInt(nowMs) ? nowMs : Date.now();
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (now - tm[id] > TOMB_DAYS * DAY_MS) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    function pick(key, norm, aliveV) {
      var best = {};
      [a[key], b[key]].forEach(function (list) {
        if (Array.isArray(list)) list.forEach(function (raw) { var x = norm(raw); if (x) lww(best, x); });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var x = best[id];
        if (id in tombs && tombs[id] >= x.m) return;
        if (aliveV && !aliveV[x.v]) return;
        if (out.length >= (aliveV ? MAX_ROWS : MAX_VEHICLES)) return;
        out.push(x);
      });
      return out;
    }
    var vehicles = pick("vehicles", normVehicle, null);
    var alive = {};
    vehicles.forEach(function (v) { alive[v.id] = true; });
    var out = { ver: DATA_VER, vehicles: vehicles };
    LIST_KEYS.forEach(function (k) { out[k] = pick(k, LISTS[k], alive); });
    // one mounted tyre set per vehicle: the newest edit wins the mount
    var mounted = {};
    out.tyres.forEach(function (t) {
      if (!t.on) return;
      var cur = mounted[t.v];
      if (!cur || t.m > cur.m || (t.m === cur.m && t.id > cur.id)) mounted[t.v] = t;
    });
    out.tyres = out.tyres.map(function (t) {
      return t.on && mounted[t.v] !== t ? Object.assign({}, t, { on: 0, okm: null }) : t;
    });
    var sa = normSettings(a.settings), sb = normSettings(b.settings);
    out.settings = sb.m > sa.m || (sb.m === sa.m && canon(sb) > canon(sa)) ? sb : sa;
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    out.tombs = sortedTombs;
    return out;
  }

  // ---------- Vehicles ----------
  function vehicle(data, vid) {
    var list = (data && data.vehicles) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === vid) return list[i];
    return null;
  }
  function hasFuel(v) { return !!(v && FUELS[v.fuel] && FUELS[v.fuel].e.length); }
  function energies(v) { return v && FUELS[v.fuel] ? FUELS[v.fuel].e.slice() : []; }
  function classOf(type) { return (TYPES[type] || TYPES.other).cls; }
  function itemsFor(type) {
    var c = classOf(type);
    return ITEM_IDS.filter(function (it) { return ITEMS[it].for.indexOf(c) >= 0; });
  }
  // Plan templates for a new vehicle: [{ item, km, mo }]. Boats run
  // on hours, not km: their plans are by months only. An electric
  // car gets no oil / air filter / timing belt plans.
  function defaultPlans(type, fuel) {
    var c = classOf(type);
    return DEFAULT_PLANS[c].map(function (it) {
      var km = ITEMS[it].km, mo = ITEMS[it].mo;
      if (c === "t" && it === "oil") km = 6000;
      if (c === "b") km = 0;
      if (fuel === "ev" && (it === "oil" || it === "timing" || it === "afilter")) return null;
      return km || mo ? { item: it, km: km, mo: mo } : null;
    }).filter(Boolean);
  }

  // Every dated odometer reading of a vehicle: fuel, service, costs
  // with km, manual readings. Sorted by day, then km.
  function readings(data, vid) {
    var out = [];
    ["fuel", "service", "costs", "odo"].forEach(function (k) {
      ((data && data[k]) || []).forEach(function (x) {
        if (x.v === vid && isInt(x.km)) out.push({ d: x.d, km: x.km });
      });
    });
    out.sort(function (x, y) { return cmpStr(x.d, y.d) || (x.km - y.km); });
    return out;
  }
  function currentKm(data, vid) {
    var best = null;
    readings(data, vid).forEach(function (r) { if (best === null || r.km > best) best = r.km; });
    return best;
  }
  // Average km per day from the readings of the last 365 days (at
  // least two, 14 days apart, rising). null when it cannot be told.
  function kmPerDay(data, vid, today) {
    var from = addDays(today, -365);
    var rs = readings(data, vid).filter(function (r) { return r.d >= from && r.d <= today; });
    if (rs.length < 2) return null;
    var first = rs[0], last = rs[rs.length - 1];
    var days = dayNum(last.d) - dayNum(first.d);
    var maxKm = rs.reduce(function (m, r) { return Math.max(m, r.km); }, 0);
    if (days < 14 || maxKm <= first.km) return null;
    return (maxKm - first.km) / days;
  }

  // ---------- Consumption (full to full) ----------
  // Only between two full fills: the partial fills in between are
  // added to the second one. A fill marked "mis" (one was not
  // logged before it) restarts the chain, so a gap never counts.
  // seg = { id (the closing fill), d, km, dist, q, per100 } (q thousandths, per100 = units
  // per 100 km). avg = sum q / sum dist (distance-weighted).
  function consumption(data, vid, energy) {
    var e = energy === "e" ? "e" : "f";
    var list = ((data && data.fuel) || []).filter(function (x) { return x.v === vid && x.e === e; })
      .sort(function (x, y) { return (x.km - y.km) || cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
    var segs = [], prev = null, acc = 0;
    list.forEach(function (x) {
      if (x.mis) { prev = x.full ? x : null; acc = 0; return; }
      if (prev === null) { if (x.full) { prev = x; acc = 0; } return; }
      acc += x.q;
      if (!x.full) return;
      var dist = x.km - prev.km;
      if (dist > 0) segs.push({ id: x.id, d: x.d, km: x.km, dist: dist, q: acc, per100: acc / 10 / dist });
      prev = x;
      acc = 0;
    });
    var dist = 0, q = 0;
    segs.forEach(function (s) { dist += s.dist; q += s.q; });
    return {
      segs: segs, dist: dist, q: q,
      avg: dist > 0 ? q / 10 / dist : null,
      last: segs.length ? segs[segs.length - 1].per100 : null
    };
  }

  // ---------- Service plans ----------
  function lastService(data, vid, item) {
    var best = null;
    ((data && data.service) || []).forEach(function (s) {
      if (s.v !== vid || s.items.indexOf(item) < 0) return;
      if (!best || s.d > best.d || (s.d === best.d && (s.km || 0) > (best.km || 0))) best = s;
    });
    return best ? { d: best.d, km: best.km, id: best.id } : null;
  }

  var SOON_KM = 500, SOON_DAYS = 14;
  // { base: {d, km}, dueKm, dueDate, leftKm, leftDays, estDate, when, level }
  //   level: "due" (passed), "soon" (≤ 500 km or ≤ 14 days), "ok"
  //   when: the date to show — dueDate, or the km date estimated
  //   from the average km/day, whichever comes first.
  function planStatus(plan, data, today) {
    var last = lastService(data, plan.v, plan.item);
    var b = { d: plan.sd, km: plan.skm };
    if (last && last.d >= plan.sd) b = { d: last.d, km: last.km };
    var cur = currentKm(data, plan.v);
    var out = { base: b, dueKm: null, dueDate: null, leftKm: null, leftDays: null, estDate: null, when: null, level: "ok" };
    if (plan.mo) {
      out.dueDate = addMonths(b.d, plan.mo);
      out.leftDays = dayNum(out.dueDate) - dayNum(today);
    }
    if (plan.km) {
      var bk = b.km;
      if (bk === null) {
        // no km at the base: the first reading on or after the base day
        readings(data, plan.v).some(function (r) { if (r.d >= b.d) { bk = r.km; return true; } return false; });
      }
      if (bk !== null && bk !== undefined) {
        out.dueKm = bk + plan.km;
        if (cur !== null) out.leftKm = out.dueKm - cur;
        var rate = kmPerDay(data, plan.v, today);
        if (rate && out.leftKm !== null) out.estDate = addDays(today, Math.max(0, Math.ceil(out.leftKm / rate)));
      }
    }
    var dates = [out.dueDate, out.estDate].filter(Boolean).sort();
    out.when = dates.length ? dates[0] : null;
    var due = (out.leftDays !== null && out.leftDays < 0) || (out.leftKm !== null && out.leftKm <= 0);
    var soon = (out.leftDays !== null && out.leftDays <= SOON_DAYS) || (out.leftKm !== null && out.leftKm <= SOON_KM);
    out.level = due ? "due" : (soon ? "soon" : "ok");
    return out;
  }

  // ---------- Renewals ----------
  // { daysLeft, level: "expired" | "soon" | "ok", step }
  //   step: the warning step reached (a day count from r.warn, or 0
  //   once expired); null while none is reached.
  function renewalStatus(r, today) {
    var left = dayNum(r.exp) - dayNum(today);
    var step = null;
    if (left <= 0) step = 0;
    else r.warn.forEach(function (w) { if (left <= w && (step === null || w < step)) step = w; });
    return { daysLeft: left, level: left < 0 ? "expired" : (step !== null ? "soon" : "ok"), step: step };
  }
  // The "Renewed" action: the cost of this renewal gets a FIXED id
  // (renewal id + the expiry it closes), so renewing on two devices
  // writes ONE cost; the new expiry is the old one + every months
  // (a one-off renewal returns next = null: the app asks for a date).
  function renewal(r) {
    var costId = (r.id + "x" + r.exp.replace(/-/g, "")).slice(-40);
    return { costId: costId, next: r.every ? addMonths(r.exp, r.every) : null };
  }

  // ---------- Tyres ----------
  function tyreStatus(t, data, today, prefs) {
    var p = readPrefs(prefs);
    var cur = currentKm(data, t.v);
    var run = t.km + (t.on && t.okm !== null && cur !== null && cur > t.okm ? cur - t.okm : 0);
    var ageY = null;
    if (t.dot) {
      var wk = +t.dot.slice(0, 2), yy = 2000 + +t.dot.slice(2, 4);
      var made = Date.UTC(yy, 0, 1) + (wk - 1) * 7 * DAY_MS;
      ageY = Math.max(0, (dayNum(today) * DAY_MS - made) / (365.25 * DAY_MS));
    }
    return {
      km: run, ageY: ageY,
      old: ageY !== null && ageY >= p.tyreAge,
      worn: t.tread > 0 && t.tread < p.tyreTread
    };
  }

  // ---------- Alerts ----------
  // alert = { key, type: "renewal"|"service"|"tyre", level, step, v, id, date }
  //   key stays the same for one cycle (renewal id + expiry, plan id
  //   + base day), so a renewed or serviced item starts fresh.
  //   Archived vehicles never alert.
  var LEVEL_RANK = { expired: 0, due: 0, soon: 1, worn: 2, old: 2 };
  function alerts(data, today, prefs) {
    var out = [], live = {};
    ((data && data.vehicles) || []).forEach(function (v) { if (!v.arch) live[v.id] = true; });
    ((data && data.renewals) || []).forEach(function (r) {
      if (!live[r.v]) return;
      var st = renewalStatus(r, today);
      if (st.step === null) return;
      out.push({ key: "r" + r.id + r.exp, type: "renewal", level: st.level === "expired" || st.daysLeft === 0 ? "expired" : "soon",
                 step: st.step, v: r.v, id: r.id, date: r.exp, left: st.daysLeft });
    });
    ((data && data.plans) || []).forEach(function (pl) {
      if (!live[pl.v]) return;
      var st = planStatus(pl, data, today);
      if (st.level === "ok") return;
      out.push({ key: "p" + pl.id + st.base.d, type: "service", level: st.level, step: st.level === "due" ? 0 : 1,
                 v: pl.v, id: pl.id, date: st.when, left: st.leftDays, leftKm: st.leftKm });
    });
    ((data && data.tyres) || []).forEach(function (t) {
      if (!live[t.v] || !t.on) return;
      var st = tyreStatus(t, data, today, prefs);
      if (!st.old && !st.worn) return;
      out.push({ key: "t" + t.id + (st.worn ? "w" : "o"), type: "tyre", level: st.worn ? "worn" : "old",
                 step: 0, v: t.v, id: t.id, date: null, left: null });
    });
    out.sort(function (x, y) {
      return (LEVEL_RANK[x.level] - LEVEL_RANK[y.level]) ||
             cmpStr(x.date || "9999", y.date || "9999") || cmpStr(x.key, y.key);
    });
    return out;
  }
  // The engine announces each alert once per step: notified[key] is
  // the lowest step already announced (device-local). An alert is
  // new when its step is lower than that (30 → 7 → 1 → 0).
  function toNotify(list, notified) {
    var n = notified && typeof notified === "object" ? notified : {};
    return list.filter(function (a) {
      return !(has(n, a.key) && isInt(n[a.key]) && n[a.key] <= a.step);
    });
  }

  // One line per alert for the shell's grouped reminder:
  // "Golf: Insurance in 5 days" · "Golf: Oil change, 300 km over".
  function alertLine(a, data, lang) {
    var el = lang === "el", v = vehicle(data, a.v), name = v ? v.name : "";
    function km(n) { try { return n.toLocaleString(el ? "el-GR" : "en-GB"); } catch (e) { return String(n); } }
    var what = "", when = "";
    function days(n) {
      if (n === 0) return el ? "σήμερα" : "today";
      if (n === 1) return el ? "αύριο" : "tomorrow";
      if (n > 1) return el ? "σε " + n + " μέρες" : "in " + n + " days";
      if (n === -1) return el ? "έληξε χθες" : "expired yesterday";
      return el ? "έληξε πριν " + (-n) + " μέρες" : "expired " + (-n) + " days ago";
    }
    if (a.type === "renewal") {
      var r = null;
      ((data && data.renewals) || []).forEach(function (x) { if (x.id === a.id) r = x; });
      what = r && r.kind === "other" && r.label ? r.label : renewalName(r ? r.kind : "other", lang);
      when = days(a.left);
    } else if (a.type === "service") {
      var p = null;
      ((data && data.plans) || []).forEach(function (x) { if (x.id === a.id) p = x; });
      what = p && p.item === "other" && p.label ? p.label : itemName(p ? p.item : "other", lang);
      if (a.leftKm !== null && a.leftKm !== undefined && (a.leftKm <= SOON_KM || a.left === null)) {
        when = a.leftKm > 0 ? (el ? "σε " + km(a.leftKm) + " km" : "in " + km(a.leftKm) + " km")
                            : (el ? "πέρασαν " + km(-a.leftKm) + " km" : km(-a.leftKm) + " km over");
      } else if (a.left !== null && a.left !== undefined) {
        when = a.left < 0 ? (el ? (-a.left) + " μέρες πίσω" : (-a.left) + " days late") : days(a.left);
      }
    } else {
      what = el ? "λάστιχα" : "tyres";
      when = a.level === "worn" ? (el ? "φαγωμένα" : "worn") : (el ? "παλιά" : "old");
    }
    return name + ": " + what + (when ? (a.type === "tyre" ? " " : ", ") + when : "");
  }

  // ---------- Money ----------
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  function costs(data, vid, from, to) {
    var o = { fuel: 0, service: 0, other: 0, total: 0 };
    ((data && data.fuel) || []).forEach(function (x) { if ((!vid || x.v === vid) && inRange(x.d, from, to)) o.fuel += x.c; });
    ((data && data.service) || []).forEach(function (x) { if ((!vid || x.v === vid) && inRange(x.d, from, to)) o.service += x.c; });
    ((data && data.costs) || []).forEach(function (x) { if ((!vid || x.v === vid) && inRange(x.d, from, to)) o.other += x.c; });
    o.total = o.fuel + o.service + o.other;
    return o;
  }
  // The last `months` calendar months up to today's, oldest first.
  function monthly(data, vid, months, today) {
    var out = [], idx = {};
    var first = addMonths(today.slice(0, 7) + "-01", -(months - 1));
    for (var i = 0; i < months; i++) {
      var ym = addMonths(first, i).slice(0, 7);
      idx[ym] = out.length;
      out.push({ ym: ym, fuel: 0, service: 0, other: 0 });
    }
    function add(list, key) {
      ((data && data[list]) || []).forEach(function (x) {
        if (vid && x.v !== vid) return;
        var k = x.d.slice(0, 7);
        if (has(idx, k)) out[idx[k]][key] += x.c;
      });
    }
    add("fuel", "fuel"); add("service", "service"); add("costs", "other");
    return out;
  }

  // ---------- CSV ----------
  // A cell can never start a formula in a spreadsheet (= + - @ tab
  // CR): such text gets a leading apostrophe. Numbers pass as is.
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // One row per entry: [date, vehicle, kind, detail, km, qty, cost, note]
  // names: { kind/item/cat id → label } supplied by the app (i18n).
  function csvRows(data, names) {
    var nm = names || {};
    function L(k) { return has(nm, k) ? nm[k] : k; }
    var vn = {};
    ((data && data.vehicles) || []).forEach(function (v) { vn[v.id] = v.name; });
    var rows = [];
    ((data && data.fuel) || []).forEach(function (x) {
      rows.push([x.d, vn[x.v], L(x.e === "e" ? "charge" : "fuel"), x.st, x.km, x.q / 1000, x.c / 100, x.n]);
    });
    ((data && data.service) || []).forEach(function (x) {
      rows.push([x.d, vn[x.v], L("service"), x.items.map(L).join(", ") + (x.shop ? " · " + x.shop : ""), x.km, null, x.c / 100, x.n]);
    });
    ((data && data.costs) || []).forEach(function (x) {
      rows.push([x.d, vn[x.v], L("cost"), L(x.cat), x.km, null, x.c / 100, x.n]);
    });
    ((data && data.odo) || []).forEach(function (x) {
      rows.push([x.d, vn[x.v], L("odo"), "", x.km, null, null, ""]);
    });
    rows.sort(function (x, y) { return cmpStr(x[0], y[0]) || cmpStr(String(x[1]), String(y[1])); });
    return rows;
  }

  // ---------- Prefs (device-local, oros-garage-prefs; the shell reads them too) ----------
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      remind: isInt(p.remind) && p.remind >= -1 && p.remind <= 23 ? p.remind : 9,
      unit: p.unit === "kmpl" ? "kmpl" : "l100",
      tyreAge: clampInt(p.tyreAge, 1, 20) || 6,
      tyreTread: clampInt(p.tyreTread, 5, 100) || 30       // tenths of a mm (3.0 mm)
    };
  }

  var api = {
    DATA_VER: DATA_VER, ID_RE: ID_RE, TYPES: TYPES, TYPE_IDS: TYPE_IDS, FUELS: FUELS, FUEL_IDS: FUEL_IDS,
    ITEMS: ITEMS, ITEM_IDS: ITEM_IDS, ITEM_NAMES: ITEM_NAMES, itemName: itemName, RENEWALS: RENEWALS, RENEWAL_IDS: RENEWAL_IDS,
    RENEWAL_NAMES: RENEWAL_NAMES, renewalName: renewalName,
    COST_CATS: COST_CATS, CURRENCIES: CURRENCIES, WARN_DEFAULT: WARN_DEFAULT, LIST_KEYS: LIST_KEYS,
    NAME_LEN: NAME_LEN, SHORT_LEN: SHORT_LEN, NOTES_LEN: NOTES_LEN, PLATE_LEN: PLATE_LEN,
    MAX_VEHICLES: MAX_VEHICLES, KM_MAX: KM_MAX, C_MAX: C_MAX, Q_MAX: Q_MAX, TOMB_DAYS: TOMB_DAYS,
    SOON_KM: SOON_KM, SOON_DAYS: SOON_DAYS,
    ymdOf: ymdOf, isYmd: isYmd, dayNum: dayNum, ymdFromDay: ymdFromDay, addDays: addDays, addMonths: addMonths,
    cleanText: cleanText, parseNum: parseNum,
    normVehicle: normVehicle, normFuel: normFuel, normService: normService, normPlan: normPlan,
    normTyre: normTyre, normRenewal: normRenewal, normCost: normCost, normOdo: normOdo,
    normSettings: normSettings, merge: merge,
    vehicle: vehicle, hasFuel: hasFuel, energies: energies, classOf: classOf, itemsFor: itemsFor,
    defaultPlans: defaultPlans, readings: readings, currentKm: currentKm, kmPerDay: kmPerDay,
    consumption: consumption, lastService: lastService, planStatus: planStatus,
    renewalStatus: renewalStatus, renewal: renewal, tyreStatus: tyreStatus,
    alerts: alerts, toNotify: toNotify, alertLine: alertLine, costs: costs, monthly: monthly,
    csvCell: csvCell, csvRows: csvRows, readPrefs: readPrefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosGarageCore = api;
})(typeof window !== "undefined" ? window : this);
