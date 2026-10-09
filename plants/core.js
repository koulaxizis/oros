// ============================================================
// orOS Plant Care — core.js (shared logic, v1.0.0)
// One file holds the schedule math, so the app and the shell's
// reminder engine can never disagree about what is due:
//   - the Plant Care app (plants/index.html)
//   - the shell (index.html → plantsCheckTick, works while the
//     app is closed)
//   - the Calendar "Plants" feed (calendar/index.html loads it
//     too: done days in the past, the next due day ahead)
// Pure functions, no DOM, no network. Dates are local calendar
// days "YYYY-MM-DD"; day arithmetic runs on whole UTC days, so a
// daylight-saving change can never move a due date.
//
// API (window.OrosPlantsCore):
//   KINDS, PRESETS, PRESET_IDS, ID_RE, DATA_VER
//   ymdOf(date), dayNum(ymd), ymdFromDay(n), addDays(ymd, n)
//   normPlant(x), normLog(x), merge(A, B, nowMs)
//   isWinter(ymd, hemi), interval(plant, kind, ymd, hemi)
//   lastByKind(data) → { plantId: { kind: ymd } }
//   nextDue(plant, kind, last, hemi) → ymd | null
//   tasks(data, today, horizonDays, hemi) → [task]
//   summary(data, today, hemi) → { n, names, outWater }
//   weather(wxData, wxCache, wxPref, today, nowMs) → { rain, hot } | null
//   avgGap(data, plantId) → days (one decimal) | null
//   readPrefs(raw) → { remind, hemi } (device-local prefs, R10)
// Data (synced slice "plants", key oros-plants-data):
//   { ver: 1, plants: [plant…] by id, log: [entry…] by id,
//     tombs: { id: deletedAt } }
//   plant = { id, m, name, sp, room, out, em, w, ww, f, mi, r, st, sn, notes }
//     w  water every n days (1–60)      ww winter interval (0 = same)
//     f  fertilize (0 = off)  mi mist (0 = off)  r repot (0 = off)
//     st schedule start (the day it was last watered when added)
//     sn { kind: ymd } postponed until (cleared when the task is done)
//   entry = { id, p (plant id), k (kind), d (ymd), s (1 = skipped), m }
// The next due day is never stored: it is computed from the log, so
// two devices that water the same plant on the same day agree.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER  = 1;
  var KINDS     = ["water", "fert", "mist", "repot"];
  var KIND_KEY  = { water: "w", fert: "f", mist: "mi", repot: "r" };
  var KIND_MAX  = { w: 60, ww: 90, f: 180, mi: 30, r: 1095 };
  var NAME_LEN  = 40;
  var ROOM_LEN  = 30;
  var NOTES_LEN = 500;
  var EM_LEN    = 8;
  var MAX_PLANTS = 300;
  var LOG_DAYS  = 730;          // entries older than two years are pruned…
  var TOMB_DAYS = 180;          // …and tombstones after half a year
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_MS = 86400000;

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
    var mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1) return false;
    return da <= new Date(Date.UTC(+m[1], mo, 0)).getUTCDate();
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

  // ---------- Helpers ----------
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : null; }
  function cleanText(s, max, multiline) {
    if (typeof s !== "string") return "";
    // Control characters out (tabs/newlines kept only in notes)
    s = s.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ");
    s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
                  : s.replace(/\s+/g, " ").trim();
    return s.slice(0, max);
  }

  // ---------- Normalizers (strict: invalid rows are DROPPED) ----------
  function normPlant(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    var w = clampInt(x.w, 1, KIND_MAX.w);
    if (!name || w === null || !isYmd(x.st)) return null;
    var sn = {};
    if (x.sn && typeof x.sn === "object") {
      KINDS.forEach(function (k) { if (isYmd(x.sn[k])) sn[k] = x.sn[k]; });
    }
    return {
      id: x.id, m: x.m, name: name,
      sp: typeof x.sp === "string" && Object.prototype.hasOwnProperty.call(PRESETS, x.sp) ? x.sp : "",
      room: cleanText(x.room, ROOM_LEN, false),
      out: x.out === 1 ? 1 : 0,
      em: typeof x.em === "string" ? cleanText(x.em, EM_LEN, false) : "",
      w: w,
      ww: clampInt(x.ww, 0, KIND_MAX.ww) || 0,
      f: clampInt(x.f, 0, KIND_MAX.f) || 0,
      mi: clampInt(x.mi, 0, KIND_MAX.mi) || 0,
      r: clampInt(x.r, 0, KIND_MAX.r) || 0,
      st: x.st,
      sn: sn,
      notes: cleanText(x.notes, NOTES_LEN, true)
    };
  }

  function normLog(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        typeof x.p !== "string" || !ID_RE.test(x.p) || KINDS.indexOf(x.k) < 0 ||
        !isYmd(x.d) || !isInt(x.m) || x.m < 0) return null;
    return { id: x.id, p: x.p, k: x.k, d: x.d, s: x.s === 1 ? 1 : 0, m: x.m };
  }

  function canon(v) { return JSON.stringify(v); }
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }

  // Symmetric, canonical merge (R5, R26). Plants LWW per id, log
  // union per id, tombstones max-merged; a tombstone at or after an
  // entity's m deletes it, a newer edit resurrects (R17). The clock
  // pruning (old log entries, old tombstones) is the SAME rule the
  // app applies locally, so a pruned row never returns with a pull.
  function merge(A, B, nowMs) {
    var a = A || {}, b = B || {};
    var now = isInt(nowMs) ? nowMs : Date.now();
    var today = ymdOf(new Date(now));
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (now - tm[id] > TOMB_DAYS * DAY_MS) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var bestP = {}, bestL = {};
    [a.plants, b.plants].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) { var x = normPlant(raw); if (x) lww(bestP, x); });
    });
    [a.log, b.log].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) { var x = normLog(raw); if (x) lww(bestL, x); });
    });
    var plants = [], alive = {};
    Object.keys(bestP).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= bestP[id].m) return;
      if (plants.length >= MAX_PLANTS) return;
      plants.push(bestP[id]);
      alive[id] = true;
    });
    // Log: only for living plants; drop tombstoned entries; prune
    // entries older than LOG_DAYS but keep the newest of each
    // plant + kind (it is the base of the schedule).
    var entries = [];
    Object.keys(bestL).forEach(function (id) {
      var x = bestL[id];
      if (!alive[x.p]) return;
      if (id in tombs && tombs[id] >= x.m) return;
      entries.push(x);
    });
    var newest = {};
    entries.forEach(function (x) {
      var key = x.p + "|" + x.k, cur = newest[key];
      if (!cur || x.d > cur.d || (x.d === cur.d && x.id > cur.id)) newest[key] = x;
    });
    var cutoff = addDays(today, -LOG_DAYS);
    var log = entries.filter(function (x) {
      return x.d >= cutoff || newest[x.p + "|" + x.k] === x;
    }).sort(function (x, y) { return cmpStr(x.id, y.id); });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, plants: plants, log: log, tombs: sortedTombs };
  }

  // ---------- Schedule ----------
  // Winter = Nov–Feb (north) / May–Aug (south). Used for the
  // optional winter watering interval only.
  function isWinter(ymd, hemi) {
    var mo = +ymd.slice(5, 7);
    return hemi === "s" ? (mo >= 5 && mo <= 8) : (mo >= 11 || mo <= 2);
  }

  function interval(plant, kind, ymd, hemi) {
    if (kind === "water") return (plant.ww > 0 && isWinter(ymd, hemi)) ? plant.ww : plant.w;
    return plant[KIND_KEY[kind]] || 0;
  }

  // { plantId: { kind: newest ymd (done or skipped) } }
  function lastByKind(data) {
    var out = {};
    ((data && data.log) || []).forEach(function (x) {
      var o = out[x.p] || (out[x.p] = {});
      if (!o[x.k] || x.d > o[x.k]) o[x.k] = x.d;
    });
    return out;
  }

  // Next due day of one task, or null when the task is off. The
  // base is the newer of the schedule start and the last time it
  // was done (or skipped); the interval is the one in force on
  // that base day. A postponement only ever moves the day later.
  function nextDue(plant, kind, last, hemi) {
    var base = plant.st;
    if (last && last > base) base = last;
    var iv = interval(plant, kind, base, hemi);
    if (!iv) return null;
    var due = addDays(base, iv);
    var sn = plant.sn && plant.sn[kind];
    if (sn && sn > due) due = sn;
    return due;
  }

  // Every task due within `horizon` days of today (overdue first).
  // task = { key, plant, kind, due, diff }  diff < 0 = late
  function tasks(data, today, horizon, hemi) {
    var last = lastByKind(data), out = [], t0 = dayNum(today);
    ((data && data.plants) || []).forEach(function (pl) {
      KINDS.forEach(function (k) {
        var due = nextDue(pl, k, last[pl.id] && last[pl.id][k], hemi);
        if (!due) return;
        var diff = dayNum(due) - t0;
        if (diff > horizon) return;
        out.push({ key: pl.id + ":" + k, plant: pl, kind: k, due: due, diff: diff });
      });
    });
    out.sort(function (x, y) {
      return (x.diff - y.diff) || (KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)) ||
             cmpStr(x.plant.name.toLowerCase(), y.plant.name.toLowerCase()) || cmpStr(x.plant.id, y.plant.id);
    });
    return out;
  }

  // What the daily reminder says: how many tasks are due today or
  // late, which plants (once each, in task order), and whether an
  // outdoor plant needs water (the weather hint applies to those).
  function summary(data, today, hemi) {
    var list = tasks(data, today, 0, hemi), names = [], seen = {}, outWater = false;
    list.forEach(function (tk) {
      if (!seen[tk.plant.id]) { seen[tk.plant.id] = true; names.push(tk.plant.name); }
      if (tk.kind === "water" && tk.plant.out) outWater = true;
    });
    return { n: list.length, names: names, outWater: outWater };
  }

  // Weather hint for TODAY from the Weather app's own cache (no
  // network). City = the one nearest the shell's tray location
  // (≤ 0.15°, the briefing's rule), else the first saved city.
  // Stale cache (> 24 h) or no row for today → null: never guess.
  var WX_NEAR_DEG = 0.15;
  function weather(wxData, wxCache, wxPref, today, nowMs) {
    if (!wxData || !Array.isArray(wxData.cities) || !wxData.cities.length ||
        !wxCache || typeof wxCache !== "object") return null;
    var city = null;
    if (wxPref && typeof wxPref.lat === "number" && typeof wxPref.lon === "number") {
      var bestD = Infinity;
      wxData.cities.forEach(function (c) {
        if (!c || typeof c.lat !== "number" || typeof c.lon !== "number") return;
        var d = Math.abs(c.lat - wxPref.lat) + Math.abs(c.lon - wxPref.lon);
        if (d < bestD) { bestD = d; city = c; }
      });
      if (bestD >= WX_NEAR_DEG) city = null;
    }
    if (!city) city = wxData.cities[0];
    var p = city && wxCache[city.id];
    if (!p || !isInt(p.at) || nowMs - p.at > DAY_MS || !Array.isArray(p.daily)) return null;
    var row = null;
    p.daily.forEach(function (d) { if (d && d.date === today) row = d; });
    if (!row) return null;
    var code = Number(row.code) || 0;
    var rain = (typeof row.pop === "number" && row.pop >= 60) ||
               (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    var hot = typeof row.max === "number" && row.max >= 33;
    return { rain: !!rain, hot: !!hot };
  }

  // Average days between real waterings (skips excluded), from the
  // last 10 gaps. Needs at least three waterings.
  function avgGap(data, plantId) {
    var days = [];
    ((data && data.log) || []).forEach(function (x) {
      if (x.p === plantId && x.k === "water" && !x.s) days.push(dayNum(x.d));
    });
    days.sort(function (a, b) { return a - b; });
    days = days.filter(function (d, i) { return i === 0 || d !== days[i - 1]; });
    if (days.length < 3) return null;
    days = days.slice(-11);
    var sum = 0;
    for (var i = 1; i < days.length; i++) sum += days[i] - days[i - 1];
    return Math.round(sum / (days.length - 1) * 10) / 10;
  }

  // Device-local prefs (oros-plants-prefs): reminder hour (-1 = off,
  // default 9) and hemisphere. The shell reads them too.
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      remind: isInt(p.remind) && p.remind >= -1 && p.remind <= 23 ? p.remind : 9,
      hemi: p.hemi === "s" ? "s" : "n"
    };
  }

  // ---------- Ready species (suggestions only — every value is editable) ----------
  // w/ww water summer/winter, f fertilize, mi mist (days, 0 = off),
  // out: usually grown outdoors. Written for orOS, general care.
  var PRESETS = {
    pothos:     { em: "🌿", w: 7,  ww: 12, f: 30, mi: 0, out: 0, en: ["Pothos", "Water when the top soil is dry. Tolerates low light."], el: ["Πόθος", "Πότισε όταν στεγνώσει η επιφάνεια. Αντέχει σε λίγο φως."] },
    monstera:   { em: "🌿", w: 7,  ww: 14, f: 30, mi: 7, out: 0, en: ["Monstera", "Bright indirect light; let the top 3 cm dry out."], el: ["Μονστέρα", "Άπλετο έμμεσο φως· άσε τα πρώτα 3 εκ. να στεγνώσουν."] },
    snake:      { em: "🪴", w: 14, ww: 30, f: 60, mi: 0, out: 0, en: ["Snake plant", "Very little water, never soggy soil."], el: ["Σανσεβιέρια", "Πολύ λίγο νερό, ποτέ λασπωμένο χώμα."] },
    zz:         { em: "🪴", w: 14, ww: 28, f: 60, mi: 0, out: 0, en: ["ZZ plant", "Stores water in its roots; let it dry fully."], el: ["Ζαμιοκούλκας", "Κρατά νερό στις ρίζες· άσ' το να στεγνώσει τελείως."] },
    ficus:      { em: "🌳", w: 7,  ww: 12, f: 30, mi: 0, out: 0, en: ["Ficus", "Steady spot, no drafts; it drops leaves when moved."], el: ["Φίκος", "Σταθερή θέση χωρίς ρεύματα· ρίχνει φύλλα όταν τον μετακινείς."] },
    spider:     { em: "🌱", w: 5,  ww: 10, f: 30, mi: 0, out: 0, en: ["Spider plant", "Keep the soil lightly moist."], el: ["Χλωρόφυτο", "Κράτα το χώμα ελαφρά υγρό."] },
    peace:      { em: "🌸", w: 5,  ww: 8,  f: 30, mi: 7, out: 0, en: ["Peace lily", "Droops when thirsty and recovers after a drink."], el: ["Σπαθίφυλλο", "Γέρνει όταν διψά και συνέρχεται μόλις ποτιστεί."] },
    orchid:     { em: "🌸", w: 7,  ww: 12, f: 14, mi: 3, out: 0, en: ["Orchid", "Soak the pot for 10 minutes, then drain well."], el: ["Ορχιδέα", "Βύθισε τη γλάστρα 10 λεπτά και στράγγιξε καλά."] },
    fern:       { em: "🌿", w: 3,  ww: 5,  f: 30, mi: 2, out: 0, en: ["Fern", "Likes humidity; never let it dry out."], el: ["Φτέρη", "Θέλει υγρασία· μην την αφήνεις να στεγνώσει."] },
    calathea:   { em: "🍃", w: 5,  ww: 8,  f: 30, mi: 3, out: 0, en: ["Calathea", "Filtered or rested water; humid air."], el: ["Καλαθέα", "Φιλτραρισμένο ή «ξεκουρασμένο» νερό, υγρός αέρας."] },
    aloe:       { em: "🌵", w: 14, ww: 30, f: 90, mi: 0, out: 0, en: ["Aloe vera", "Deep water, then let it dry completely."], el: ["Αλόη", "Πότισμα σε βάθος, μετά να στεγνώσει εντελώς."] },
    cactus:     { em: "🌵", w: 14, ww: 35, f: 60, mi: 0, out: 0, en: ["Cactus", "Almost no water in winter."], el: ["Κάκτος", "Σχεδόν καθόλου νερό τον χειμώνα."] },
    succulent:  { em: "🪴", w: 10, ww: 21, f: 60, mi: 0, out: 0, en: ["Succulent", "Soak and dry; lots of light."], el: ["Παχύφυτο", "Πότισμα και στέγνωμα· πολύ φως."] },
    rubber:     { em: "🌳", w: 7,  ww: 14, f: 30, mi: 0, out: 0, en: ["Rubber plant", "Wipe the leaves; water when half dry."], el: ["Καουτσούκ", "Σκούπιζε τα φύλλα· πότισε όταν στεγνώσει στη μέση."] },
    dracaena:   { em: "🌴", w: 10, ww: 14, f: 30, mi: 0, out: 0, en: ["Dracaena", "Sensitive to fluoride; let it dry between waterings."], el: ["Δράκαινα", "Ευαίσθητη στο φθόριο· άσ' τη να στεγνώνει ανάμεσα."] },
    begonia:    { em: "🌺", w: 4,  ww: 7,  f: 14, mi: 0, out: 0, en: ["Begonia", "Water the soil, not the leaves."], el: ["Βιγόνια", "Πότιζε το χώμα, όχι τα φύλλα."] },
    violet:     { em: "💜", w: 5,  ww: 7,  f: 14, mi: 0, out: 0, en: ["African violet", "Water from below with room-temperature water."], el: ["Αφρικανική βιολέτα", "Πότισμα από κάτω, με νερό θερμοκρασίας δωματίου."] },
    basil:      { em: "🌿", w: 2,  ww: 3,  f: 14, mi: 0, out: 1, en: ["Basil", "Daily in heat; pinch the flowers."], el: ["Βασιλικός", "Καθημερινά στη ζέστη· κόβε τα λουλούδια."] },
    mint:       { em: "🌱", w: 2,  ww: 4,  f: 30, mi: 0, out: 1, en: ["Mint", "Loves moist soil; keep it in its own pot."], el: ["Δυόσμος", "Θέλει υγρό χώμα· σε δική του γλάστρα."] },
    rosemary:   { em: "🌿", w: 7,  ww: 14, f: 60, mi: 0, out: 1, en: ["Rosemary", "Drought-tolerant; full sun."], el: ["Δεντρολίβανο", "Αντέχει την ξηρασία· πλήρης ήλιος."] },
    lavender:   { em: "💜", w: 7,  ww: 21, f: 90, mi: 0, out: 1, en: ["Lavender", "Little water, lots of sun, poor soil."], el: ["Λεβάντα", "Λίγο νερό, πολύς ήλιος, φτωχό χώμα."] },
    geranium:   { em: "🌺", w: 3,  ww: 10, f: 14, mi: 0, out: 1, en: ["Geranium", "Water when the soil surface is dry."], el: ["Γεράνι", "Πότισε όταν στεγνώσει η επιφάνεια."] },
    tomato:     { em: "🍅", w: 1,  ww: 0,  f: 14, mi: 0, out: 1, en: ["Tomato", "Deep, regular watering at the base."], el: ["Ντομάτα", "Τακτικό, βαθύ πότισμα στη βάση."] },
    bougainvillea: { em: "🌺", w: 4, ww: 14, f: 30, mi: 0, out: 1, en: ["Bougainvillea", "Flowers best when kept slightly dry."], el: ["Βουκαμβίλια", "Ανθίζει καλύτερα όταν μένει λίγο στεγνή."] },
    citrus:     { em: "🍋", w: 4,  ww: 10, f: 30, mi: 0, out: 1, en: ["Lemon tree (pot)", "Deep watering; good drainage."], el: ["Λεμονιά (γλάστρα)", "Πότισμα σε βάθος, καλή αποστράγγιση."] },
    olive:      { em: "🫒", w: 7,  ww: 21, f: 60, mi: 0, out: 1, en: ["Olive (pot)", "Hardy; let it dry between waterings."], el: ["Ελιά (γλάστρα)", "Ανθεκτική· άσ' τη να στεγνώνει ανάμεσα."] }
  };
  var PRESET_IDS = Object.keys(PRESETS);

  var api = {
    DATA_VER: DATA_VER, KINDS: KINDS, KIND_KEY: KIND_KEY, KIND_MAX: KIND_MAX,
    NAME_LEN: NAME_LEN, ROOM_LEN: ROOM_LEN, NOTES_LEN: NOTES_LEN, EM_LEN: EM_LEN,
    MAX_PLANTS: MAX_PLANTS, LOG_DAYS: LOG_DAYS, TOMB_DAYS: TOMB_DAYS,
    ID_RE: ID_RE, PRESETS: PRESETS, PRESET_IDS: PRESET_IDS,
    ymdOf: ymdOf, isYmd: isYmd, dayNum: dayNum, ymdFromDay: ymdFromDay, addDays: addDays,
    cleanText: cleanText, normPlant: normPlant, normLog: normLog, merge: merge,
    isWinter: isWinter, interval: interval, lastByKind: lastByKind, nextDue: nextDue,
    tasks: tasks, summary: summary, weather: weather, avgGap: avgGap, readPrefs: readPrefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosPlantsCore = api;
})(typeof window !== "undefined" ? window : this);
