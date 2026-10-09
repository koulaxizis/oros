// ============================================================
// orOS Pet Health Book — core.js (shared logic, v1.0.0)
// One file holds the data rules and the "what is due" math, so the
// app, the shell's reminder engine and the Calendar feed can never
// disagree:
//   - the Pet Health Book app (petcare/index.html)
//   - the shell (index.html → petcareCheckTick, works while the
//     app is closed)
//   - the Calendar "Pets" feed (calendar/index.html loads it too)
// Pure functions, no DOM, no network. Dates are local calendar
// days "YYYY-MM-DD"; day arithmetic runs on whole UTC days, so a
// daylight-saving change can never move a due date.
//
// Not to be confused with Pet World / Screen Pet (pet.js,
// petworld/): this is the health book of REAL animals. No data and
// no code is shared with them.
//
// API (window.OrosPetcareCore):
//   SPECIES, SPECIES_IDS, CARE_KINDS, REC_KINDS, DEWORM_TYPES,
//   VACCINES, ID_RE, DATA_VER, limits
//   ymdOf, isYmd, isBirth, dayNum, ymdFromDay, addDays, cleanText
//   normPet(x), normRec(x), merge(A, B, nowMs), touch(pet, before, nowMs)
//   age(birth, today) → { y, mo, approx } | null
//   birthdayOn(pet, ymd) → years | 0
//   items(data, today) → [item] every open due date (no horizon)
//   leadFor(kind, lead) → days before the due day a reminder starts
//   reminders(data, today, lead, fired) → { items, fired }
//   weights(data, petId), weightDelta(list)
//   foodOut(pet) → ymd | null      costYear(data, petId, year)
//   readPrefs(raw) → { remind, lead } (device-local prefs, R10)
// Data (synced slice "petcare", key oros-petcare-data):
//   { ver: 1, pets: [pet…] by id, recs: [rec…] by id,
//     tombs: { id: deletedAt } }
//   pet = { id, m, name, sp, breed, sex, neut, birth, color, chip,
//           pass, ins, alg, vet: { n, c, ph }, eph,
//           food: { n, g, ml, bag, open }, wmin, wmax,
//           care: { kind: days }, cs: { kind: ymd }, ph, gone, notes,
//           fm: { group: mtime } }
//     birth "YYYY-MM-DD", or "YYYY-MM" / "YYYY" when only roughly known
//     grams everywhere (food g/day, bag, wmin/wmax): integers, no floats
//     cs = the day each routine care started (base of its first cycle)
//     gone = "YYYY-MM-DD" when the pet passed away / was rehomed:
//            the book stays, the reminders stop
//     fm = per field-group mtime (GROUPS): two devices that edit
//          different parts of the same pet (one the vet, the other
//          the food) both keep their edit; m = the newest of them
//   rec = { id, p (pet id), k (kind), d (ymd), m, nt (notes), … }
//     vacc   n name, nx next dose, b batch, v vet
//     deworm t int|ext|both, n product, nx next dose
//     visit  n reason, dg diagnosis, tr treatment, c cost (cents), nx recheck, v vet
//     med    n name, ds dose, fq how often, u last day of the course
//     weight g grams
//     care   c care kind (one routine care done)
//     food   n new food (a food change, history only)
// "Next" dates are never derived from a stored counter: they come
// from the newest record of each kind, so two devices agree.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER  = 1;
  var NAME_LEN  = 40;
  var TEXT_LEN  = 60;
  var LONG_LEN  = 200;
  var NOTES_LEN = 1000;
  var REC_NOTES = 500;
  var PHONE_LEN = 30;
  var MAX_PETS  = 50;
  var MAX_RECS  = 5000;
  var TOMB_DAYS = 180;
  var PHOTO_MAX = 28000;            // chars of the data URI (~20 KB)
  var PHOTO_BUDGET = 400000;        // all photos together (~300 KB), enforced by the app
  var FOOD_LEAD = 5;                // "food runs out" warns 5 days ahead
  var REFIRE_DAYS = 7;              // an overdue reminder repeats weekly
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/;
  var DAY_MS = 86400000;

  var SPECIES = {
    dog:     { em: "🐕", en: "Dog",     el: "Σκύλος" },
    cat:     { em: "🐈", en: "Cat",     el: "Γάτα" },
    bird:    { em: "🐦", en: "Bird",    el: "Πουλί" },
    rabbit:  { em: "🐇", en: "Rabbit",  el: "Κουνέλι" },
    rodent:  { em: "🐹", en: "Rodent",  el: "Τρωκτικό" },
    fish:    { em: "🐟", en: "Fish",    el: "Ψάρι" },
    reptile: { em: "🦎", en: "Reptile", el: "Ερπετό" },
    horse:   { em: "🐴", en: "Horse",   el: "Άλογο" },
    other:   { em: "🐾", en: "Other",   el: "Άλλο" }
  };
  var SPECIES_IDS = ["dog", "cat", "bird", "rabbit", "rodent", "fish", "reptile", "horse", "other"];
  var REC_KINDS = ["vacc", "deworm", "visit", "med", "weight", "care", "food"];
  var CARE_KINDS = ["bath", "nails", "brush", "teeth", "ears", "litter", "cage", "tank"];
  var DEWORM_TYPES = ["int", "ext", "both"];

  // Ready vaccine names (suggestions only: the name is stored as
  // text and the next date is always editable). `days` = the usual
  // gap to the next dose; the vet's word wins.
  var VACCINES = {
    dog: [
      { id: "dhpp",   days: 365, en: "Combination (DHPPi/L)", el: "Πολυδύναμο (DHPPi/L)" },
      { id: "rabies", days: 365, en: "Rabies", el: "Λύσσα" },
      { id: "leish",  days: 365, en: "Leishmaniasis", el: "Λεϊσμανίαση" },
      { id: "kennel", days: 365, en: "Kennel cough", el: "Βήχας της κυνοτροφείου" }
    ],
    cat: [
      { id: "rcp",    days: 365, en: "Feline combination (RCP)", el: "Τριδύναμο γάτας (RCP)" },
      { id: "felv",   days: 365, en: "Feline leukaemia (FeLV)", el: "Λευχαιμία γάτας (FeLV)" },
      { id: "rabies", days: 365, en: "Rabies", el: "Λύσσα" }
    ],
    rabbit: [
      { id: "myxo",   days: 365, en: "Myxomatosis + RHD", el: "Μυξωμάτωση + αιμορραγική νόσος (RHD)" }
    ],
    horse: [
      { id: "flu",    days: 365, en: "Equine influenza", el: "Γρίπη των ίππων" },
      { id: "tetanus", days: 730, en: "Tetanus", el: "Τέτανος" }
    ]
  };
  // Field groups of a pet, merged one by one (the newer group wins).
  // Nearly one field each; fields validated together share a group.
  var GROUPS = {
    name: ["name"], sp: ["sp"], breed: ["breed"], sex: ["sex", "neut"], birth: ["birth"],
    color: ["color"], ph: ["ph"], chip: ["chip"], pass: ["pass"], ins: ["ins"], alg: ["alg"],
    weight: ["wmin", "wmax"], vet: ["vet"], eph: ["eph"], food: ["food"], care: ["care", "cs"],
    notes: ["notes"], gone: ["gone"]
  };
  var GROUP_IDS = Object.keys(GROUPS);

  // Usual gap between deworming doses (days): internal 3 months,
  // external (pipette, tablet) 1 month.
  var DEWORM_DAYS = { int: 90, ext: 30, both: 30 };

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
  // "YYYY-MM-DD", or "YYYY-MM" / "YYYY" for a roughly known birth.
  function isBirth(s) {
    if (typeof s !== "string") return false;
    var y = +s.slice(0, 4);
    if (!/^\d{4}/.test(s) || y < 1950 || y > 2200) return false;
    if (s.length === 4) return true;
    if (s.length === 7) { var mo = +s.slice(5, 7); return /^\d{4}-\d{2}$/.test(s) && mo >= 1 && mo <= 12; }
    return isYmd(s);
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
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : null; }
  function cleanText(s, max, multiline) {
    if (typeof s !== "string") return "";
    s = s.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, multiline ? "" : " ");
    s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
                  : s.replace(/\s+/g, " ").trim();
    return s.slice(0, max);
  }
  // Phone numbers end up in a tel: link: digits and + ( ) - space only.
  function cleanPhone(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[^0-9+()\- ]/g, "").replace(/\s+/g, " ").trim().slice(0, PHONE_LEN);
  }
  function cleanCode(s) {
    if (typeof s !== "string") return "";
    return s.replace(/[^A-Za-z0-9\- ]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
  }
  function ymdOrEmpty(s) { return isYmd(s) ? s : ""; }
  function lowKey(s) { return s.toLowerCase().replace(/\s+/g, " ").trim(); }

  // ---------- Normalizers (strict: invalid rows are DROPPED) ----------
  function normPet(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name) return null;
    var vet = x.vet && typeof x.vet === "object" ? x.vet : {};
    var food = x.food && typeof x.food === "object" ? x.food : {};
    var care = {}, cs = {};
    if (x.care && typeof x.care === "object" && x.cs && typeof x.cs === "object") {
      CARE_KINDS.forEach(function (k) {
        var n = clampInt(x.care[k], 1, 365);
        if (n !== null && isYmd(x.cs[k])) { care[k] = n; cs[k] = x.cs[k]; }
      });
    }
    var wmin = clampInt(x.wmin, 0, 2000000) || 0, wmax = clampInt(x.wmax, 0, 2000000) || 0;
    if (wmin && wmax && wmin > wmax) { wmin = 0; wmax = 0; }
    var ph = typeof x.ph === "string" && x.ph.length <= PHOTO_MAX && PHOTO_RE.test(x.ph) ? x.ph : "";
    var fm = {};
    GROUP_IDS.forEach(function (g) {
      var v = x.fm && typeof x.fm === "object" ? clampInt(x.fm[g], 0, x.m) : null;
      fm[g] = v === null ? x.m : v;
    });
    return {
      id: x.id, m: x.m, name: name,
      sp: typeof x.sp === "string" && has(SPECIES, x.sp) ? x.sp : "other",
      breed: cleanText(x.breed, NAME_LEN, false),
      sex: x.sex === "f" || x.sex === "m" ? x.sex : "",
      neut: x.neut === 1 ? 1 : 0,
      birth: isBirth(x.birth) ? x.birth : "",
      color: cleanText(x.color, NAME_LEN, false),
      chip: cleanCode(x.chip),
      pass: cleanCode(x.pass),
      ins: cleanText(x.ins, TEXT_LEN, false),
      alg: cleanText(x.alg, LONG_LEN, false),
      vet: { n: cleanText(vet.n, TEXT_LEN, false), c: cleanText(vet.c, TEXT_LEN, false), ph: cleanPhone(vet.ph) },
      eph: cleanPhone(x.eph),
      food: {
        n: cleanText(food.n, TEXT_LEN, false),
        g: clampInt(food.g, 0, 20000) || 0,
        ml: clampInt(food.ml, 0, 12) || 0,
        bag: clampInt(food.bag, 0, 100000) || 0,
        open: ymdOrEmpty(food.open)
      },
      wmin: wmin, wmax: wmax,
      care: care, cs: cs,
      ph: ph,
      gone: ymdOrEmpty(x.gone),
      notes: cleanText(x.notes, NOTES_LEN, true),
      fm: fm
    };
  }

  function groupVals(p, g) {
    var o = {};
    GROUPS[g].forEach(function (k) { o[k] = p[k]; });
    return JSON.stringify(o);
  }
  // Field-group merge of two copies of one pet: per group the newer
  // fm wins (equal fm: the larger canonical JSON), m = the max.
  function mergePet(x, y) {
    var out = {};
    Object.keys(x).forEach(function (k) { out[k] = x[k]; });
    out.fm = {};
    GROUP_IDS.forEach(function (g) {
      var src = x;
      if (y.fm[g] > x.fm[g] || (y.fm[g] === x.fm[g] && groupVals(y, g) > groupVals(x, g))) src = y;
      GROUPS[g].forEach(function (k) { out[k] = src[k]; });
      out.fm[g] = src.fm[g];
    });
    out.m = Math.max(x.m, y.m);
    return normPet(out);
  }

  // After an edit of `pet` (a normalized draft) against `before`
  // (the stored copy, or null for a new pet): stamps m and the fm of
  // every group that really changed (R27). Returns false when
  // nothing changed (then nothing is stamped).
  function touch(pet, before, nowMs) {
    var now = isInt(nowMs) ? nowMs : Date.now();
    if (!before) {
      pet.m = now;
      GROUP_IDS.forEach(function (g) { pet.fm[g] = now; });
      return true;
    }
    var changed = GROUP_IDS.filter(function (g) { return groupVals(pet, g) !== groupVals(before, g); });
    if (!changed.length) { pet.m = before.m; pet.fm = JSON.parse(JSON.stringify(before.fm)); return false; }
    var m = Math.max(now, before.m + 1);
    pet.fm = JSON.parse(JSON.stringify(before.fm));
    changed.forEach(function (g) { pet.fm[g] = m; });
    pet.m = m;
    return true;
  }

  function normRec(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        typeof x.p !== "string" || !ID_RE.test(x.p) || REC_KINDS.indexOf(x.k) < 0 ||
        !isYmd(x.d) || !isInt(x.m) || x.m < 0) return null;
    var r = { id: x.id, p: x.p, k: x.k, d: x.d, m: x.m };
    var nt = cleanText(x.nt, REC_NOTES, true);
    var nx = isYmd(x.nx) && x.nx > x.d ? x.nx : "";
    switch (x.k) {
      case "vacc":
        r.n = cleanText(x.n, TEXT_LEN, false);
        if (!r.n) return null;
        r.nx = nx;
        r.b = cleanText(x.b, NAME_LEN, false);
        r.v = cleanText(x.v, TEXT_LEN, false);
        break;
      case "deworm":
        r.t = DEWORM_TYPES.indexOf(x.t) >= 0 ? x.t : "int";
        r.n = cleanText(x.n, TEXT_LEN, false);
        r.nx = nx;
        break;
      case "visit":
        r.n = cleanText(x.n, TEXT_LEN, false);
        r.dg = cleanText(x.dg, LONG_LEN, false);
        r.tr = cleanText(x.tr, LONG_LEN, false);
        r.c = clampInt(x.c, 0, 100000000) || 0;
        r.nx = nx;
        r.v = cleanText(x.v, TEXT_LEN, false);
        break;
      case "med":
        r.n = cleanText(x.n, TEXT_LEN, false);
        if (!r.n) return null;
        r.ds = cleanText(x.ds, TEXT_LEN, false);
        r.fq = cleanText(x.fq, TEXT_LEN, false);
        r.u = isYmd(x.u) && x.u >= x.d ? x.u : "";
        break;
      case "weight":
        r.g = clampInt(x.g, 1, 2000000);
        if (r.g === null) return null;
        break;
      case "care":
        if (CARE_KINDS.indexOf(x.c) < 0) return null;
        r.c = x.c;
        break;
      case "food":
        r.n = cleanText(x.n, TEXT_LEN, false);
        if (!r.n) return null;
        break;
    }
    r.nt = nt;
    return r;
  }

  function canon(v) { return JSON.stringify(v); }
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }

  // Symmetric, canonical merge (R5, R26). Pets merge per field group
  // (mergePet), records LWW per id (equal m: larger canonical JSON),
  // tombstones max-merged; a
  // tombstone at or after an entity's m deletes it, a newer edit
  // resurrects (R17). Records of a deleted pet go with it. Old
  // tombstones are pruned by the same clock rule everywhere.
  function merge(A, B, nowMs) {
    var a = A || {}, b = B || {};
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
    var bestP = {}, bestR = {};
    [a.pets, b.pets].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) {
        var x = normPet(raw);
        if (x) bestP[x.id] = bestP[x.id] ? mergePet(bestP[x.id], x) : x;
      });
    });
    [a.recs, b.recs].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) { var x = normRec(raw); if (x) lww(bestR, x); });
    });
    var pets = [], alive = {};
    Object.keys(bestP).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= bestP[id].m) return;
      if (pets.length >= MAX_PETS) return;
      pets.push(bestP[id]);
      alive[id] = true;
    });
    var recs = [];
    Object.keys(bestR).forEach(function (id) {
      var x = bestR[id];
      if (!alive[x.p]) return;
      if (id in tombs && tombs[id] >= x.m) return;
      recs.push(x);
    });
    if (recs.length > MAX_RECS) {
      // Keep the newest records (by day, then id): deterministic on
      // every device, so the cut never ping-pongs.
      recs.sort(function (x, y) { return cmpStr(y.d, x.d) || cmpStr(y.id, x.id); });
      recs = recs.slice(0, MAX_RECS);
    }
    recs.sort(function (x, y) { return cmpStr(x.id, y.id); });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, pets: pets, recs: recs, tombs: sortedTombs };
  }

  // ---------- Age + birthdays ----------
  // A rough birth ("2019" or "2019-05") counts from the first day of
  // that year / month and is flagged approx.
  function age(birth, today) {
    if (!isBirth(birth) || !isYmd(today)) return null;
    var approx = birth.length < 10;
    var y = +birth.slice(0, 4), mo = birth.length >= 7 ? +birth.slice(5, 7) : 1,
        da = birth.length === 10 ? +birth.slice(8, 10) : 1;
    var ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
    var months = (ty - y) * 12 + (tm - mo) - (td < da ? 1 : 0);
    if (months < 0) return null;
    return { y: Math.floor(months / 12), mo: months % 12, approx: approx };
  }

  // Years completed on `ymd` when it is the pet's birthday (full
  // date only; 29 Feb falls on 28 Feb in other years), else 0.
  function birthdayOn(pet, ymd) {
    if (!pet || typeof pet.birth !== "string" || pet.birth.length !== 10 || !isYmd(pet.birth) || !isYmd(ymd)) return 0;
    var years = +ymd.slice(0, 4) - +pet.birth.slice(0, 4);
    if (years < 1) return 0;
    var md = pet.birth.slice(5);
    if (md === "02-29" && !isYmd(ymd.slice(0, 4) + "-02-29")) md = "02-28";
    return ymd.slice(5) === md ? years : 0;
  }

  // ---------- What is due ----------
  function newest(list) {
    var best = null;
    list.forEach(function (r) { if (!best || r.d > best.d || (r.d === best.d && r.id > best.id)) best = r; });
    return best;
  }

  // Every open due date of the living pets (gone pets: none).
  //   item = { key, pet, kind, sub, label, due, diff, rec }
  //   kind vacc | deworm | visit (recheck) | med (course ends) |
  //        care | food (runs out)
  //   sub  deworm type / care kind (for i18n); label = user text
  // Vaccines: the newest dose of each vaccine name (case-blind)
  // carries the next date. Deworming: the newest internal and the
  // newest external dose ("both" counts for each). Recheck: the
  // newest visit only. A course of medicine: its last day, today or
  // later. Routine care: last done (or the day it started) + days.
  // Food: bag opened + bag grams / grams a day.
  function items(data, today) {
    var out = [], t0 = dayNum(today);
    var byPet = {};
    ((data && data.recs) || []).forEach(function (r) { (byPet[r.p] || (byPet[r.p] = [])).push(r); });
    ((data && data.pets) || []).forEach(function (pet) {
      if (pet.gone) return;
      var recs = byPet[pet.id] || [];
      function push(key, kind, sub, label, due, rec) {
        if (!due) return;
        out.push({ key: pet.id + ":" + key, pet: pet, kind: kind, sub: sub || "", label: label || "",
                   due: due, diff: dayNum(due) - t0, rec: rec || null });
      }
      // Vaccines
      var vacc = {};
      recs.forEach(function (r) { if (r.k === "vacc") (vacc[lowKey(r.n)] || (vacc[lowKey(r.n)] = [])).push(r); });
      Object.keys(vacc).sort(cmpStr).forEach(function (k) {
        var r = newest(vacc[k]);
        if (r.nx) push("vacc:" + k, "vacc", "", r.n, r.nx, r);
      });
      // Deworming
      var dInt = newest(recs.filter(function (r) { return r.k === "deworm" && r.t !== "ext"; }));
      var dExt = newest(recs.filter(function (r) { return r.k === "deworm" && r.t !== "int"; }));
      if (dInt && dInt === dExt) push("deworm:both", "deworm", "both", dInt.n, dInt.nx, dInt);
      else {
        if (dInt) push("deworm:int", "deworm", "int", dInt.n, dInt.nx, dInt);
        if (dExt) push("deworm:ext", "deworm", "ext", dExt.n, dExt.nx, dExt);
      }
      // Recheck after the newest visit
      var v = newest(recs.filter(function (r) { return r.k === "visit"; }));
      if (v && v.nx) push("visit", "visit", "", v.n, v.nx, v);
      // Medicine courses that end today or later
      recs.forEach(function (r) {
        if (r.k === "med" && r.u && dayNum(r.u) >= t0) push("med:" + r.id, "med", "", r.n, r.u, r);
      });
      // Routine care
      var lastCare = {};
      recs.forEach(function (r) { if (r.k === "care" && (!lastCare[r.c] || r.d > lastCare[r.c])) lastCare[r.c] = r.d; });
      CARE_KINDS.forEach(function (k) {
        if (!pet.care[k]) return;
        var base = pet.cs[k];
        if (lastCare[k] && lastCare[k] > base) base = lastCare[k];
        push("care:" + k, "care", k, "", addDays(base, pet.care[k]), null);
      });
      // Food
      var fo = foodOut(pet);
      if (fo) push("food", "food", "", pet.food.n, fo, null);
    });
    var ORDER = ["vacc", "deworm", "visit", "med", "food", "care"];
    out.sort(function (x, y) {
      return (x.diff - y.diff) || (ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind)) ||
             cmpStr(x.pet.name.toLowerCase(), y.pet.name.toLowerCase()) || cmpStr(x.key, y.key);
    });
    return out;
  }

  function foodOut(pet) {
    var f = pet && pet.food;
    if (!f || !f.g || !f.bag || !f.open) return null;
    return addDays(f.open, Math.floor(f.bag / f.g));
  }

  // Days before the due day a reminder starts: vaccines, deworming
  // and rechecks use the user's lead (default 7), food 5 (or less),
  // routine care and the end of a course only on the day.
  function leadFor(kind, lead) {
    var l = clampInt(lead, 0, 30);
    if (l === null) l = 7;
    if (kind === "food") return Math.min(FOOD_LEAD, l);
    if (kind === "care" || kind === "med") return 0;
    return l;
  }

  // Which items the daily reminder announces now, and the new
  // device-local "fired" map (oros-petcare-fired). Each due date is
  // announced once ahead ("s", within its lead) and once when due
  // ("d"); an overdue one again every 7 days. The map only keeps
  // keys that are still open, so it never grows.
  function reminders(data, today, lead, fired) {
    var f0 = fired && typeof fired === "object" ? fired : {};
    var t0 = dayNum(today), next = {}, out = [];
    items(data, today).forEach(function (it) {
      if (it.diff > leadFor(it.kind, lead)) return;
      if (it.kind === "med" && it.diff !== 0) return;
      var fk = it.key + "@" + it.due;
      var stg = it.diff > 0 ? "s" : "d";
      var f = has(f0, fk) ? f0[fk] : null;
      var ok = f && typeof f === "object" && (f.s === "s" || f.s === "d") && isYmd(f.d);
      var fire = !ok || f.s !== stg || (stg === "d" && t0 - dayNum(f.d) >= REFIRE_DAYS);
      next[fk] = fire ? { s: stg, d: today } : { s: f.s, d: f.d };
      if (fire) out.push(it);
    });
    return { items: out, fired: next };
  }

  // ---------- Weight, food, costs ----------
  function weights(data, petId) {
    return ((data && data.recs) || []).filter(function (r) { return r.k === "weight" && r.p === petId; })
      .sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
  }
  // Change of the newest weight against the newest one at least 30
  // days older (grams), or null.
  function weightDelta(list) {
    if (!list || list.length < 2) return null;
    var last = list[list.length - 1], ref = null, cut = addDays(last.d, -30);
    for (var i = list.length - 2; i >= 0; i--) if (list[i].d <= cut) { ref = list[i]; break; }
    return ref ? last.g - ref.g : null;
  }
  function costYear(data, petId, year) {
    var sum = 0, y = String(year);
    ((data && data.recs) || []).forEach(function (r) {
      if (r.k === "visit" && r.p === petId && r.d.slice(0, 4) === y) sum += r.c;
    });
    return sum;
  }

  // Device-local prefs (oros-petcare-prefs): reminder hour (-1 =
  // off, default 9) and the days of warning (0–30, default 7). The
  // shell reads them too.
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      remind: isInt(p.remind) && p.remind >= -1 && p.remind <= 23 ? p.remind : 9,
      lead: isInt(p.lead) && p.lead >= 0 && p.lead <= 30 ? p.lead : 7
    };
  }

  var api = {
    DATA_VER: DATA_VER, NAME_LEN: NAME_LEN, TEXT_LEN: TEXT_LEN, LONG_LEN: LONG_LEN,
    NOTES_LEN: NOTES_LEN, REC_NOTES: REC_NOTES, PHONE_LEN: PHONE_LEN,
    MAX_PETS: MAX_PETS, MAX_RECS: MAX_RECS, TOMB_DAYS: TOMB_DAYS,
    PHOTO_MAX: PHOTO_MAX, PHOTO_BUDGET: PHOTO_BUDGET, PHOTO_RE: PHOTO_RE, FOOD_LEAD: FOOD_LEAD,
    ID_RE: ID_RE, SPECIES: SPECIES, SPECIES_IDS: SPECIES_IDS, REC_KINDS: REC_KINDS,
    CARE_KINDS: CARE_KINDS, DEWORM_TYPES: DEWORM_TYPES, DEWORM_DAYS: DEWORM_DAYS, VACCINES: VACCINES,
    ymdOf: ymdOf, isYmd: isYmd, isBirth: isBirth, dayNum: dayNum, ymdFromDay: ymdFromDay, addDays: addDays,
    cleanText: cleanText, cleanPhone: cleanPhone, cleanCode: cleanCode,
    GROUPS: GROUPS, GROUP_IDS: GROUP_IDS,
    normPet: normPet, normRec: normRec, merge: merge, touch: touch,
    age: age, birthdayOn: birthdayOn, items: items, leadFor: leadFor, reminders: reminders,
    weights: weights, weightDelta: weightDelta, foodOut: foodOut, costYear: costYear, readPrefs: readPrefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosPetcareCore = api;
})(typeof window !== "undefined" ? window : this);
