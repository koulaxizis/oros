// ============================================================
// orOS Garage — .orosgarage file (garage/package.js,
// window.OrosGaragePackage). The descriptor of Garage for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every vehicle, fuel and charging fill, service, service plan, tyre
// set, renewal, expense and km reading in one orOS bundle; receipt
// photos (Files › Garage/Receipts) go in media/<sha256>.jpg. Opening
// one ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code. Needs
// core.js (OrosGarageCore).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; garage.js then runs settle
//                            and its own save, which is core.merge +
//                            sync dirty). core.merge is pure, but it
//                            would let a mounted tyre set from a file
//                            unmount the one on this device, and its
//                            caps (30 vehicles, 20 000 rows a list,
//                            kept in id order) could push out a record
//                            of this device
//   DESC.norm(data)          a file's data → the slice's lists, every
//                            row through core.js's own norm* (invalid
//                            rows dropped); receipt names only when they
//                            carry their row's own id; rcs checked
//   DESC.strip(state)        the slice → { ver, settings, vehicles,
//                            fuel, service, plans, tyres, renewals,
//                            costs, odo, rcs? }: no tombstones (device
//                            prefs never are in the slice: reminder
//                            hour, unit, tyre limits, tab, vehicle)
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  log.csv: the app's Export CSV (same
//                            columns, Greek: ";" and "12,5")
//   rcs                      receipts: { "<file name>": "<sha256>.jpg" },
//                            the media key of each photo a row's rc
//                            names (garage.js's files hook fills it)
//   settle(next, local, addedIds, incoming, now)
//                            what an open may add, before save: added
//                            vehicles / rows over the app's caps are
//                            left out, an added tyre set is not mounted
//                            when this device already has one mounted
//                            on that vehicle, and a device that never
//                            chose a currency (no vehicles, settings
//                            m 0) takes the file's
//   undo(data, ids, now)     Undo of an opened file → { data, files }:
//                            the app's own delete (tombstone at or above
//                            the row's stamp); an added vehicle stays
//                            when rows of this device were added to it
//                            since; files = receipt names to drop later
//   csvText(data, lang)      the Export CSV text
// Never in the file: tombstones, device prefs, the reminders' state.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./core.js") : root.OrosGarageCore; }

  var LISTS = ["vehicles", "fuel", "service", "plans", "tyres", "renewals", "costs", "odo"];
  var RC_LISTS = ["fuel", "service", "costs"];
  var MAX_ROWS = 20000;                        // core.js: per list
  var KEY_RE = /^[0-9a-f]{64}\.jpg$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function normFor(C, k) {
    return { vehicles: C.normVehicle, fuel: C.normFuel, service: C.normService, plans: C.normPlan,
             tyres: C.normTyre, renewals: C.normRenewal, costs: C.normCost, odo: C.normOdo }[k];
  }
  // a receipt name of this row: "<date>-<row id>-<random>.jpg" (core.receiptName)
  function ownRc(name, id) { return typeof name === "string" && name.indexOf("-" + id + "-") === 8; }

  // receipts map: names some row's rc holds → a <sha256>.jpg key
  function normRcs(rcs, d) {
    var out = {}, used = {};
    if (!isObj(rcs)) return out;
    RC_LISTS.forEach(function (k) {
      (d[k] || []).forEach(function (x) { (x.rc || []).forEach(function (n) { used[n] = 1; }); });
    });
    Object.keys(rcs).sort().forEach(function (n) {
      var key = rcs[n];
      if (has(used, n) && core().RC_RE.test(n) && typeof key === "string" && KEY_RE.test(key)) out[n] = key;
    });
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var C = core(), out = { ver: C.DATA_VER, settings: C.normSettings(data.settings) };
    LISTS.forEach(function (k) {
      var fn = normFor(C, k), list = [], seen = {};
      var cap = k === "vehicles" ? C.MAX_VEHICLES : MAX_ROWS;
      (Array.isArray(data[k]) ? data[k] : []).slice(0, cap * 2).forEach(function (r) {
        if (list.length >= cap) return;
        var x = fn(r);
        if (!x || has(seen, x.id)) return;
        seen[x.id] = 1;
        if (x.rc) {
          x.rc = x.rc.filter(function (n) { return ownRc(n, x.id); });
          if (!x.rc.length) delete x.rc;
        }
        list.push(x);
      });
      out[k] = list;
    });
    var rcs = normRcs(data.rcs, out);
    if (Object.keys(rcs).length) out.rcs = rcs;
    if (isObj(data.tombs)) {                    // strip and tombIds see them, then they go
      out.tombs = {};
      Object.keys(data.tombs).forEach(function (id) { if (C.ID_RE.test(id)) out.tombs[id] = 1; });
    }
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, C = core();
    var out = { ver: C.DATA_VER, settings: clone(isObj(s.settings) ? s.settings : { m: 0, cur: "EUR" }) };
    LISTS.forEach(function (k) { out[k] = Array.isArray(s[k]) ? clone(s[k]) : []; });
    var rcs = normRcs(s.rcs, out);
    if (Object.keys(rcs).length) out.rcs = rcs;
    return out;
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- preview: the app's Export CSV (garage.js exportCsv) ----------
  // Same keys and English as garage.js (one "garage" pack); WORDS[lang]
  // = { kind, cat, head } is built from it.
  var CSV_WORDS = {
    en: {
      "kind.fuel": "Fuel", "kind.charge": "Charging", "kind.service": "Service", "kind.cost": "Expense", "kind.odo": "Km reading",
      "cat.toll": "Tolls", "cat.park": "Parking", "cat.wash": "Wash", "cat.fine": "Fines", "cat.parts": "Parts", "cat.acc": "Accessories",
      "cat.kteo": "KTEO", "cat.ins": "Insurance", "cat.tax": "Road tax", "cat.kek": "Emissions card", "cat.road": "Roadside assistance",
      "cat.lic": "Driving licence", "cat.rent": "Rental", "cat.other": "Other",
      "csv.date": "Date", "csv.vehicle": "Vehicle", "csv.kind": "Kind", "csv.details": "Details", "csv.km": "Km",
      "csv.qty": "Quantity", "csv.cost": "Cost ({c})", "csv.notes": "Notes"
    },
    el: {
      "kind.fuel": "Καύσιμα", "kind.charge": "Φόρτιση", "kind.service": "Σέρβις", "kind.cost": "Έξοδο", "kind.odo": "Χιλιόμετρα",
      "cat.toll": "Διόδια", "cat.park": "Στάθμευση", "cat.wash": "Πλύσιμο", "cat.fine": "Πρόστιμα", "cat.parts": "Ανταλλακτικά", "cat.acc": "Αξεσουάρ",
      "cat.kteo": "ΚΤΕΟ", "cat.ins": "Ασφάλεια", "cat.tax": "Τέλη κυκλοφορίας", "cat.kek": "Κάρτα καυσαερίων", "cat.road": "Οδική βοήθεια",
      "cat.lic": "Δίπλωμα οδήγησης", "cat.rent": "Ενοικίαση", "cat.other": "Άλλο",
      "csv.date": "Ημερομηνία", "csv.vehicle": "Όχημα", "csv.kind": "Είδος", "csv.details": "Λεπτομέρειες", "csv.km": "Km",
      "csv.qty": "Ποσότητα", "csv.cost": "Κόστος ({c})", "csv.notes": "Σημειώσεις"
    }
  };
  var KINDS = ["fuel", "charge", "service", "cost", "odo"];
  var CATS = ["toll", "park", "wash", "fine", "parts", "acc", "kteo", "ins", "tax", "kek", "road", "lic", "rent", "other"];
  var HEAD = ["date", "vehicle", "kind", "details", "km", "qty", "cost", "notes"];
  // lang: "en", "el" or a pack language (window.orosI18n, when loaded;
  // in Node: English)
  function wordsOf(lang) {
    var tb = CSV_WORDS[lang];
    if (!tb && typeof window !== "undefined" && window.orosI18n && lang) tb = window.orosI18n.table(CSV_WORDS, "garage", lang);
    tb = tb || CSV_WORDS.en;
    var w = { kind: {}, cat: {}, head: [] };
    KINDS.forEach(function (k) { w.kind[k] = tb["kind." + k]; });
    CATS.forEach(function (k) { w.cat[k] = tb["cat." + k]; });
    HEAD.forEach(function (k) { w.head.push(tb["csv." + k]); });
    return w;
  }
  var WORDS = { en: wordsOf("en"), el: wordsOf("el") };
  // core.csvCell puts an apostrophe before = + - @ tab CR (no formulas)
  function csvText(data, lang) {
    var C = core(), d = isObj(data) ? data : {};
    var L = typeof lang === "string" && lang ? lang : "en", W = WORDS[L] || wordsOf(L);
    var el = C.commaDecimal ? C.commaDecimal(L) : L === "el";   // decimal comma and ";"
    var cur = isObj(d.settings) && typeof d.settings.cur === "string" ? d.settings.cur : "EUR";
    var names = {};
    Object.keys(W.kind).forEach(function (k) { names[k] = W.kind[k]; });
    C.ITEM_IDS.forEach(function (it) { names[it] = C.itemName(it, L); });
    C.COST_CATS.forEach(function (c) { names[c] = W.cat[c]; });
    var sep = el ? ";" : ",";
    var lines = [W.head.map(function (h) { return C.csvCell(h.replace("{c}", cur)); }).join(sep)];
    C.csvRows(d, names).forEach(function (r) {
      lines.push(r.map(function (v) {
        if (typeof v === "number" && el) return String(v).replace(".", ",");
        return C.csvCell(v);
      }).join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  function previews(state, lang) {
    var s = isObj(state) ? state : {};
    var any = ["fuel", "service", "costs", "odo"].some(function (k) { return Array.isArray(s[k]) && s[k].length; });
    return any ? { "log.csv": csvText(s, lang) } : {};
  }

  // ---------- settle: what an open adds, before save ----------
  function settle(next, local, addedIds, incoming, now) {
    var C = core(), d = clone(isObj(next) ? next : {}), added = {}, gone = {};
    now = typeof now === "number" ? now : Date.now();
    (addedIds || []).forEach(function (id) { added[String(id)] = 1; });
    var tombs = isObj(d.tombs) ? d.tombs : {};
    // vehicles: the app keeps at most MAX_VEHICLES (in id order); added
    // ones over that are left out, with their added rows
    var vs = Array.isArray(d.vehicles) ? d.vehicles : [];
    var live = vs.filter(function (v) { return !(has(tombs, v.id) && tombs[v.id] >= v.m); });
    for (var i = vs.length - 1; i >= 0 && live.length > C.MAX_VEHICLES; i--) {
      if (!added[vs[i].id]) continue;
      gone[vs[i].id] = 1;
      live = live.filter(function (v) { return v.id !== vs[i].id; });
      vs.splice(i, 1);
    }
    LISTS.forEach(function (k) {
      if (k === "vehicles" || !Array.isArray(d[k])) return;
      d[k] = d[k].filter(function (x) { return !(added[x.id] && gone[x.v]); });
      for (var j = d[k].length - 1; j >= 0 && d[k].length > MAX_ROWS; j--) if (added[d[k][j].id]) d[k].splice(j, 1);
    });
    // one mounted tyre set per vehicle: the one on this device stays mounted
    var mounted = {};
    (d.tyres || []).forEach(function (t) { if (t.on === 1 && !added[t.id]) mounted[t.v] = 1; });
    (d.tyres || []).forEach(function (t) {
      if (t.on === 1 && added[t.id] && mounted[t.v]) { t.on = 0; t.okm = null; }
    });
    // a device that never chose a currency (and has no vehicle) takes the file's
    var ls = isObj(local) && isObj(local.settings) ? local.settings : { m: 0 };
    var inc = isObj(incoming) && isObj(incoming.settings) ? C.normSettings(incoming.settings) : null;
    var hadV = isObj(local) && Array.isArray(local.vehicles) && local.vehicles.length > 0;
    if (inc && inc.m > 0 && !(ls.m > 0) && !hadV) d.settings = { m: Math.min(inc.m, now + 5 * 60 * 1000), cur: inc.cur };
    return d;
  }

  // ---------- Undo of an opened file ----------
  function undo(data, ids, now) {
    var C = core(), d = clone(isObj(data) ? data : {}), set = {}, files = [];
    now = typeof now === "number" ? now : Date.now();
    if (!isObj(d.tombs)) d.tombs = {};
    (ids || []).forEach(function (id) { set[String(id)] = 1; });
    LISTS.forEach(function (k) {
      if (k === "vehicles" || !Array.isArray(d[k])) return;
      d[k] = d[k].filter(function (x) {
        if (!set[x.id]) return true;
        d.tombs[x.id] = Math.max(now, x.m || 0);
        if (x.rc) files = files.concat(x.rc);
        return false;
      });
    });
    // a vehicle goes too, unless rows were added to it since
    d.vehicles = (d.vehicles || []).filter(function (v) {
      if (!set[v.id]) return true;
      var used = LISTS.some(function (k) { return k !== "vehicles" && (d[k] || []).some(function (x) { return x.v === v.id; }); });
      if (used) return true;
      d.tombs[v.id] = Math.max(now, v.m || 0);
      return false;
    });
    return { data: C.merge(d, d, now), files: files };
  }

  var DESC = {
    app: "garage", title: "Garage", slice: "garage", ext: ".orosgarage", mime: "application/x-oros-garage",
    colls: {
      vehicles: { shape: "array", id: "id", stamp: "m" },
      fuel: { shape: "array", id: "id", stamp: "m" },
      service: { shape: "array", id: "id", stamp: "m" },
      plans: { shape: "array", id: "id", stamp: "m" },
      tyres: { shape: "array", id: "id", stamp: "m" },
      renewals: { shape: "array", id: "id", stamp: "m" },
      costs: { shape: "array", id: "id", stamp: "m" },
      odo: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, LISTS: LISTS, RC_LISTS: RC_LISTS, KEY_RE: KEY_RE, WORDS: WORDS,
              settle: settle, undo: undo, csvText: csvText, normRcs: normRcs };
  if (NODE) module.exports = api;
  else root.OrosGaragePackage = api;
})(typeof window !== "undefined" ? window : this);
