// ============================================================
// orOS Garage — import.js (pure logic: "Import from another app")
// Reads a file the person exported from another vehicle log, as
// DATA only (nothing is run, nothing becomes HTML):
//   - Fuelio     backup "vehicle-N-sync.csv": sections "## Vehicle"
//                (Name, Make, Model, Year, Plate, DistUnit 0 km / 1
//                mi, FuelUnit 0 L / 1 US gal / 2 UK gal, Tank1Type…),
//                "## Log" (Data, Odo (km), Fuel (litres), Full, Price
//                = total, VolumePrice, City, Notes, Missed, TankNumber,
//                FuelType…), "## CostCategories" (CostTypeID, Name),
//                "## Costs" (CostTitle, Date, Odo, CostTypeID, Notes,
//                Cost, isIncome, isTemplate…). Other sections ignored.
//   - Drivvo     CSV export with sections (Refuelling / Expense /
//                Service / Income, also in Portuguese / Spanish) or
//                one file per kind: Date, Odometer, Fuel, Price/L,
//                Total cost, Full tank, Station, Type, Notes…
//   - Fuelly     car_name, model, mpg, odometer, miles, gallons,
//                price (per gallon), fuelup_date, tags, notes,
//                missed_fuelup, partial_fuelup, brand…
//   - aCar       fill-up CSV: Date, Odometer Reading, Volume, Price
//                per Volume Unit, Total Cost, Partial Fill-Up?,
//                Previous Missed Fill-Ups?, Fuel Brand, Notes…;
//                service CSV: Date, Odometer Reading, Services…
//   - LubeLogger one CSV per record type: Gas (Date, Odometer,
//                FuelConsumed, Cost, FuelEconomy, IsFillToFull,
//                MissedFuelUp, Notes, Tags), Service / Repair /
//                Upgrade / Tax (Date, Odometer, Description, Cost,
//                Notes, Tags; the kind comes from the file name)
//   - any CSV    with a date and odometer + quantity (fills), or a
//                date and an amount (service / expenses)
// A ZIP is opened and its .csv entries read (one vehicle each).
// Records keep the file's own units; plan() converts them to what
// Garage stores (integer km, litres in thousandths) with the units
// the person confirms in the preview (detected from the headers).
//   parseText(text, name)  → { source, vehicles: [{ key, name, make,
//                              model, year, plate, tank, fuel }],
//                              recs: [rec], units: { dist, vol, sure },
//                              skipped: { income, bad } }
//                              or { error: "bad"|"empty"|"big" }
//   readBytes(bytes, name) → Promise of the same (ZIP aware)
//   plan(res, data, opts)  → what an import would ADD to Garage data:
//     opts { vk: file vehicle key, vid: target vehicle id ("" = a
//     new one), dist: "km"|"mi", vol: "l"|"usgal"|"ukgal", lang }
//     → { vid, vehicle: new row | null, fuel, service, costs: [row],
//         stats: { fuel, full, partial, missed, service, costs,
//         cats: { cat: n }, dup, from, to, skipped: { … } } }
// Stable ids: "imp" + hashes of the target vehicle and the record
// (date, km, quantity, amount…), so importing the same file again
// adds nothing; a record that matches an entry already there (same
// date + odometer + amount) is skipped. Rows come out normalized by
// core.js (strict), with m = 0: the app stamps them when it writes.
// Caps: file size, characters, rows, ZIP entries, text lengths.
// Needs OrosImportKit (../importkit.js) and OrosGarageCore; ZIP
// needs AtelierZip. UMD: window.OrosGarageImport / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;
  var C = NODE ? require("./core.js") : root.OrosGarageCore;

  var MAX_FILE = 20 * 1024 * 1024;
  var MAX_TEXT = 20 * 1024 * 1024;
  var MAX_RECS = 20000;
  var MAX_ZIP_ENTRIES = 40;
  var MAX_VEH = 30;
  var MI = 1.609344, US_GAL = 3.785411784, UK_GAL = 4.54609;
  var VOL = { l: 1, usgal: US_GAL, ukgal: UK_GAL };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return v === null || v === undefined ? "" : String(v); }
  function low(v) { return K.clean(v, 300).toLowerCase(); }
  function numOr(v) { var n = K.num(v); return isFinite(n) ? n : null; }
  function truthy(v) { return /^(1|true|yes|y|x|full|sim|sí|si|ja|oui|ναι|on|checked)$/i.test(K.clean(v, 20)); }

  // ---------- 1. Dates ----------
  // a leading ISO date is taken as written (no time-zone shift),
  // else the kit's parser with a D/M/Y or M/D/Y hint from the column
  function dkey(v, hint) {
    var s = K.clean(v, 60);
    if (!s) return "";
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    var k = m ? m[1] + "-" + (m[2].length < 2 ? "0" : "") + m[2] + "-" + (m[3].length < 2 ? "0" : "") + m[3] : K.ymd(s, hint);
    return k && C.isYmd(k) ? k : "";
  }
  function dateHint(vals) {
    var dmy = false, mdy = false;
    vals.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(str(v));
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    return dmy && !mdy ? "dmy" : (mdy && !dmy ? "mdy" : "");
  }

  // ---------- 2. Words → Garage categories ----------
  var SVC_RE = /servic|maint|repair|mechanic|garage|workshop|oil|filter|brake|tyre|tire|batter|σέρβις|σερβις|συντήρ|επισκευ|συνεργ|manuten|mantenim|revis|repar|oficina|taller|wartung|inspektion|entretien|révision/;
  var CAT_WORDS = [
    ["toll", /toll|διόδ|peaje|pedágio|pedagio|maut|péage|vignet/],
    ["park", /park|στάθμ|σταθμ|estacion|parqu|parcheggio/],
    ["wash", /wash|πλύσ|πλυσ|lavag|lavado|lavaggio|wäsche/],
    ["fine", /fine|ticket|penalt|πρόστιμ|προστιμ|κλήσ|multa|bußgeld|amende/],
    ["kteo", /kteo|κτεο|κ\.τ\.ε\.ο|inspection|\bmot\b|\bitv\b|vistoria|\btüv|roadworth/],
    ["ins", /insur|ασφάλ|ασφαλ|seguro|versicher|assurance/],
    ["tax", /tax|registr|τέλη|τελη|imposto|ipva|impuesto|licenciamento|steuer/],
    ["kek", /emission|καυσαερ/],
    ["road", /roadside|assistance|οδική|οδικη|guincho|grúa|grua/],
    ["lic", /licen[cs]e|δίπλωμα|διπλωμα|habilita|carnet/],
    ["rent", /rent|lease|leasing|ενοίκ|ενοικ|μίσθ|aluguel|alquiler|financ|loan|δόσ/],
    ["parts", /\bparts?\b|ανταλλακτ|peça|peças|pieza|repuesto|ersatzteil/],
    ["acc", /accessor|upgrade|tuning|modif|αξεσουάρ|αξεσουαρ|acessório|accesorio|zubehör/]
  ];
  function catOf(text) {
    var s = low(text);
    for (var i = 0; i < CAT_WORDS.length; i++) if (CAT_WORDS[i][1].test(s)) return CAT_WORDS[i][0];
    return "other";
  }
  function isService(text) { return SVC_RE.test(low(text)); }
  // service items named in the text (order of the list = priority)
  var ITEM_WORDS = [
    ["gearbox", /gear ?box|transmission|κιβώτ|κιβωτ|câmbio|cambio|getriebe/],
    ["ofilter", /oil filter|φίλτρο λαδ|φιλτρο λαδ|filtro de óleo|filtro de aceite|ölfilter/],
    ["oil", /oil change|engine oil|motor oil|^oil$|\boil\b(?! filter)|λάδια|λαδια|λάδι μηχ|troca de óleo|óleo|aceite|ölwechsel|vidange/],
    ["afilter", /air filter|φίλτρο αέρα|φιλτρο αερα|filtro de ar\b|filtro de aire|luftfilter/],
    ["cabin", /cabin|pollen|καμπίν|καμπιν|ar condicionado filtro|innenraum/],
    ["ffilter", /fuel filter|φίλτρο καυσ|φιλτρο καυσ|filtro de combust|kraftstofffilter/],
    ["plugs", /spark|\bplugs?\b|μπουζ|vela|bujía|bujia|zündkerze/],
    ["brakes", /brake|φρέν|φρεν|freio|freno|bremse|frein/],
    ["timing", /timing|χρονισμ|correia dentada|distribuci|zahnriemen|distribution/],
    ["belt", /drive belt|ιμάντας κίν|ιμαντας κιν/],
    ["chain", /\bchain\b|αλυσίδ|αλυσιδ|corrente|cadena|kette/],
    ["battery", /batter|μπαταρ|bateria|batería|batterie/],
    ["coolant", /coolant|antifreeze|αντιψυκτ|arrefecimento|refrigerante|kühlmittel/],
    ["ac", /\ba\/c\b|air con|κλιματ|ar condicionado|aire acondicionado|klima/],
    ["rotation", /rotation|εναλλαγ|rodízio|rotación/],
    ["tyres", /tyre|tire|λάστιχ|λαστιχ|ελαστικ|pneu|neumát|neumat|reifen/],
    ["wipers", /wiper|υαλοκαθ|limpador|limpiaparabrisas|wischer/],
    ["general", /general service|annual service|full service|γενικό σέρβις|γενικο σερβις|revisão|revision|inspektion|^service$|^servicing$/]
  ];
  function itemsOf(text, allowed) {
    var s = low(text), out = [];
    ITEM_WORDS.forEach(function (w) {
      if (w[1].test(s) && (!allowed || allowed.indexOf(w[0]) >= 0) && out.indexOf(w[0]) < 0) out.push(w[0]);
    });
    return out.length ? out : ["other"];
  }
  // fuel type words / Fuelio codes → a Garage fuel id
  function fuelOf(v) {
    var s = low(v);
    if (!s) return "";
    if (/^\d+$/.test(s)) {
      var n = +s;
      if (n >= 100) n = Math.floor(n / 100);
      return ["", "petrol", "diesel", "petrol", "lpg", "cng", "ev"][n] || "";
    }
    if (/diesel|gasóleo|gasoleo|πετρέλ|πετρελ/.test(s)) return "diesel";
    if (/lpg|autogas|glp|υγραέρ|υγραερ|gpl/.test(s)) return "lpg";
    if (/cng|gnv|natural gas|φυσικό|metano/.test(s)) return "cng";
    if (/electr|kwh|ηλεκτρ|elétr|eléctr/.test(s)) return "ev";
    if (/petrol|gasol|gasoline|unleaded|benz|βενζ|super|ethanol|etanol|álcool|alcool|e10|e85/.test(s)) return "petrol";
    return "";
  }

  // ---------- 3. Units from headers ----------
  function unitsOf(head) {
    var dist = "", vol = "";
    head.forEach(function (h) {
      var s = low(h);
      if (!dist) {
        if (/\((mi|miles?)\)|\bmiles?\b|\bmpg\b/.test(s)) dist = "mi";
        else if (/\((km|kms)\)|\bkm\b|kilomet|l\/100/.test(s)) dist = "km";
      }
      if (!vol) {
        if (/imp(erial)?\.? ?gal|uk ?gal/.test(s)) vol = "ukgal";
        else if (/gal/.test(s)) vol = "usgal";
        else if (/\((l|litres?|liters?|litros?)\)|\blitres?\b|\bliters?\b|\blitros?\b|l\/100|\/ ?l$|per lit/.test(s)) vol = "l";
      }
    });
    return { dist: dist, vol: vol };
  }

  // ---------- 4. Records ----------
  // fuel: { k: "f", vk, d, odo, trip, vol, cost, unit, full, mis, st, n, tank, ft }
  // other: { k: "s" | "c", vk, d, odo, cost, text, n, shop, cat }
  function out(source) {
    var res = { source: source, vehicles: [], recs: [], units: { dist: "", vol: "", sure: false }, skipped: { income: 0, bad: 0 } };
    res.add = function (r) {
      if (res.recs.length >= MAX_RECS) return;
      if (!r.d) { res.skipped.bad++; return; }
      res.recs.push(r);
    };
    res.veh = function (v) {
      var key = K.clean(v.key, 80);
      for (var i = 0; i < res.vehicles.length; i++) if (res.vehicles[i].key === key) return key;
      if (res.vehicles.length >= MAX_VEH) return res.vehicles[0].key;
      res.vehicles.push({
        key: key, name: K.clean(v.name, 40), make: K.clean(v.make, 40), model: K.clean(v.model, 40),
        year: (function (y) { y = numOr(y); return y && y >= 1900 && y <= 2200 ? Math.round(y) : 0; })(v.year),
        plate: K.clean(v.plate, 16).toUpperCase(), tank: (function (t) { t = numOr(t); return t && t > 0 && t < 1000 ? Math.round(t) : 0; })(v.tank),
        fuel: v.fuel || ""
      });
      return key;
    };
    return res;
  }
  function finish(res) {
    delete res.add; delete res.veh;
    if (!res.vehicles.length) res.vehicles.push({ key: "", name: "", make: "", model: "", year: 0, plate: "", tank: 0, fuel: "" });
    // a fill without an odometer but with the trip: the last known
    // odometer of that vehicle + the trip (in date order)
    var last = {};
    res.recs.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return a.r.d < b.r.d ? -1 : (a.r.d > b.r.d ? 1 : a.i - b.i); })
      .forEach(function (x) {
        var r = x.r;
        if (r.k !== "f") return;
        if (r.odo === null && r.trip > 0 && last[r.vk] !== undefined) r.odo = last[r.vk] + r.trip;
        if (r.odo !== null) last[r.vk] = r.odo;
      });
    res.recs.forEach(function (r) { delete r.trip; });
    if (!res.recs.length) return { error: "empty", source: res.source };
    if (!res.vehicles.some(function (v) { return v.fuel; })) {
      var ft = "";
      res.recs.some(function (r) { ft = r.k === "f" ? fuelOf(r.ft) : ""; return !!ft; });
      res.vehicles.forEach(function (v) { if (!v.fuel) v.fuel = ft; });
    }
    return res;
  }

  // column lists (any matches, case / punctuation ignored)
  var H = {
    date: ["date", "data", "fecha", "datum", "date time", "datetime", "fuelup_date", "fill date", "ημερομηνία"],
    odo: ["odometer", "odo", "odo (km)", "odo (mi)", "odometer reading", "odômetro", "odometro", "odómetro", "mileage", "km", "kilometers", "kilometres", "χιλιόμετρα", "οδόμετρο"],
    trip: ["miles", "trip", "trip distance", "distance", "kilometers driven", "km driven"],
    vol: ["fuel (litres)", "fuel (liters)", "fuel (gal)", "fuel (gallons)", "fuelconsumed", "fuel consumed", "volume", "quantity", "liters", "litres", "gallons", "litros", "quantidade", "cantidad", "amount of fuel", "fuel amount", "fuel quantity", "λίτρα", "ποσότητα"],
    unit: ["volumeprice", "price/l", "price / l", "price per liter", "price per litre", "price per gallon", "price per volume unit", "price/volume", "unit price", "fuel price", "preço", "preço/l", "precio", "precio/l", "τιμή", "τιμή λίτρου"],
    total: ["total cost", "price (optional)", "total", "totalcost", "total price", "total value", "valor total", "valor", "costo total", "coste total", "cost", "amount", "sum", "κόστος", "σύνολο", "ποσό"],
    full: ["full", "full tank", "tank full", "filled tank", "isfilltofull", "full fill", "tanque cheio", "tanque lleno", "γεμάτο"],
    partial: ["partial_fuelup", "partial fuelup", "partial", "partial fill-up?", "partial fill up", "partial fillup", "partial fill"],
    missed: ["missed", "missed_fuelup", "missedfuelup", "missed fuelup", "previous missed fill-ups?", "previous missed fillups", "missed previous", "previous refuelling missing", "missed fill up"],
    station: ["gas station", "station", "fuel station", "brand", "fuel brand", "posto", "gasolinera", "city", "πρατήριο"],
    notes: ["notes", "note", "observation", "observations", "observação", "observações", "observacion", "notas", "comments", "comment", "σημειώσεις"],
    tags: ["tags", "tag"],
    ftype: ["fuel type", "fueltype", "combustível", "combustivel", "combustible", "fuel grade", "καύσιμο"],
    text: ["description", "type", "expense type", "service type", "services", "service", "category", "expense", "title", "costtitle", "tipo", "tipo de despesa", "tipo de serviço", "tipo de servicio", "name", "περιγραφή", "είδος"],
    shop: ["place", "workshop", "service center name", "service center", "local", "taller", "oficina", "shop", "garage", "συνεργείο"],
    vname: ["car_name", "vehicle", "vehicle name", "car", "veículo", "vehiculo", "όχημα"],
    vmodel: ["model"],
    income: ["isincome", "income"],
    template: ["istemplate"]
  };
  function g(rec, k) { return K.get(rec, H[k]); }
  function hasCol(head, k) { return K.col(head, H[k]) !== -1; }
  function notesOf(rec) {
    var n = K.cleanText(g(rec, "notes"), 500), tg = K.clean(g(rec, "tags"), 120);
    return tg ? (n ? n + " · " : "") + tg : n;
  }
  function objOf(head, row) {
    var o = {};
    head.forEach(function (h, i) { if (h && !has(o, h)) o[h] = row[i] == null ? "" : row[i]; });
    return o;
  }

  // one block of rows (a CSV file or a section) of fills
  function fuelBlock(res, head, rows, opt) {
    opt = opt || {};
    var hd = hasCol(head, "date") ? K.col(head, H.date) : -1;
    var hint = dateHint(rows.map(function (r) { return r[hd]; }));
    // "Fuel" alone is the quantity when its values are numbers,
    // else the fuel type (Drivvo)
    var fuelCol = K.col(head, ["fuel"]), fuelIsQty = false;
    if (fuelCol !== -1 && !hasCol(head, "vol")) {
      var nums = 0, seen = 0;
      rows.slice(0, 50).forEach(function (r) { var s = K.clean(r[fuelCol], 30); if (s) { seen++; if (isFinite(K.num(s)) && /^[\d\s.,]+$/.test(s)) nums++; } });
      fuelIsQty = seen > 0 && nums === seen;
    }
    var fullCol = hasCol(head, "full"), partCol = hasCol(head, "partial");
    rows.forEach(function (row) {
      var r = objOf(head, row);
      if (opt.skipRow && opt.skipRow(r)) return;
      var vol = fuelIsQty ? numOr(r[head[fuelCol]]) : numOr(g(r, "vol"));
      var unit = numOr(opt.priceUnit ? K.get(r, ["price"]) : g(r, "unit")), total = numOr(g(r, "total"));
      if ((vol === null || vol <= 0) && unit > 0 && total > 0) vol = total / unit;
      if ((total === null || total <= 0) && unit > 0 && vol > 0) total = unit * vol;
      var full = 1;
      if (partCol) full = truthy(g(r, "partial")) ? 0 : 1;
      else if (fullCol) full = truthy(g(r, "full")) ? 1 : 0;
      var vk = opt.vk !== undefined ? opt.vk : res.veh({ key: K.clean(g(r, "vname"), 80), name: g(r, "vname"), model: g(r, "vmodel") });
      var ft = fuelCol !== -1 && !fuelIsQty ? r[head[fuelCol]] : g(r, "ftype");
      var rec = {
        k: "f", vk: vk, d: dkey(r[head[hd]], hint),
        odo: (function (o) { return o !== null && o > 0 ? o : null; })(numOr(g(r, "odo"))),
        trip: numOr(g(r, "trip")) || 0,
        vol: vol, cost: total, full: full, mis: truthy(g(r, "missed")) ? 1 : 0,
        st: K.clean(g(r, "station"), 40), n: notesOf(r),
        tank: opt.tank ? (numOr(opt.tank(r)) || 1) : 1, ft: K.clean(ft, 40)
      };
      if (opt.extra) opt.extra(r, rec);
      res.add(rec);
    });
  }
  // one block of service / expense rows; kind "s" | "c" | "" (decide per row)
  function otherBlock(res, head, rows, kind, opt) {
    opt = opt || {};
    var hd = K.col(head, H.date);
    var hint = dateHint(rows.map(function (r) { return r[hd]; }));
    rows.forEach(function (row) {
      var r = objOf(head, row);
      if (truthy(g(r, "template"))) return;
      if (truthy(g(r, "income"))) { res.skipped.income++; return; }
      var text = opt.text ? opt.text(r) : K.clean(g(r, "text"), 200);
      var n = notesOf(r);
      var k = kind || (isService(text) ? "s" : "c");
      var vk = opt.vk !== undefined ? opt.vk : res.veh({ key: K.clean(g(r, "vname"), 80), name: g(r, "vname"), model: g(r, "vmodel") });
      res.add({
        k: k, vk: vk, d: dkey(r[head[hd]], hint),
        odo: (function (o) { return o !== null && o > 0 ? o : null; })(numOr(g(r, "odo"))),
        cost: numOr(g(r, "total")), text: text, n: n, shop: K.clean(g(r, "shop"), 40),
        cat: opt.cat || "", items: opt.items || ""
      });
    });
  }

  // ---------- 5. Parsers ----------
  // A sectioned CSV (Fuelio, Drivvo): "## Name" (or a lone known
  // section word) starts a section, its next row is the header.
  var DRIVVO_SEC = [
    ["f", /^(refuel+ing|refuel+ings|fuel|fuelings?|abastecimentos?|repostajes?|recargas?|charging|tankowani[ae])$/],
    ["c", /^(expenses?|despesas?|gastos?|wydatki)$/],
    ["s", /^(services?|serviços?|servicios?|serwis|maintenance|manutenção|mantenimiento)$/],
    ["i", /^(incomes?|receitas?|ingresos?|przychody)$/]
  ];
  function secKind(name) {
    var s = low(name);
    for (var i = 0; i < DRIVVO_SEC.length; i++) if (DRIVVO_SEC[i][1].test(s)) return DRIVVO_SEC[i][0];
    return "";
  }
  function sniffDelim(text) {
    var lines = text.split(/\r?\n/, 40).filter(function (l) { return l && !/^\s*"?#/.test(l); }).slice(0, 6);
    var best = ",", bestN = 0;
    [",", ";", "\t", "|"].forEach(function (d) {
      var n = 0;
      lines.forEach(function (l) { n += l.split(d).length - 1; });
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }
  function sections(text) {
    var t = K.csv(text, { delim: sniffDelim(text), maxRows: MAX_RECS * 3 });
    var all = [t.head].concat(t.rows), secs = [], cur = null;
    all.forEach(function (row) {
      var c0 = K.clean(row[0], 80), rest = row.slice(1).every(function (c) { return !K.clean(c, 5); });
      if (rest && (/^#/.test(c0) || (c0 && secKind(c0)))) {
        cur = { name: c0.replace(/^#+\s*/, ""), head: null, rows: [] };
        secs.push(cur);
        return;
      }
      if (!cur) return;
      if (!cur.head) { cur.head = row.map(function (h) { return K.clean(h, 200); }); return; }
      if (row.every(function (c) { return !K.clean(c, 5); })) return;
      cur.rows.push(row);
    });
    return secs.filter(function (s) { return s.head; });
  }
  function sec(secs, re) {
    for (var i = 0; i < secs.length; i++) if (re.test(low(secs[i].name))) return secs[i];
    return null;
  }

  function parseFuelio(secs, name) {
    var res = out("fuelio");
    var vs = sec(secs, /^vehicle$/), vk = "";
    var vehUnits = { dist: "", vol: "" };
    if (vs && vs.rows[0]) {
      var v = objOf(vs.head, vs.rows[0]);
      vk = res.veh({
        key: "fuelio:" + K.clean(K.get(v, ["Name"]), 60), name: K.get(v, ["Name"]), make: K.get(v, ["Make"]),
        model: K.get(v, ["Model"]), year: K.get(v, ["Year"]), plate: K.get(v, ["Plate"]),
        tank: K.get(v, ["Tank1Capacity"]), fuel: fuelOf(K.get(v, ["Tank1Type"]))
      });
      var du = K.clean(K.get(v, ["DistUnit"]), 5), fu = K.clean(K.get(v, ["FuelUnit"]), 5);
      if (du !== "") vehUnits.dist = du === "1" ? "mi" : "km";
      if (fu !== "") vehUnits.vol = fu === "1" ? "usgal" : (fu === "2" ? "ukgal" : "l");
    } else vk = res.veh({ key: "fuelio:" + K.clean(name, 60), name: "" });
    var log = sec(secs, /^log$/);
    if (log) {
      var hu = unitsOf(log.head);
      res.units = { dist: hu.dist || vehUnits.dist || "km", vol: hu.vol || vehUnits.vol || "l", sure: true };
      // Fuelio: "Price (optional)" is the total, VolumePrice the unit price
      fuelBlock(res, log.head, log.rows, { vk: vk, tank: function (r) { return K.get(r, ["TankNumber"]); } });
    } else res.units = { dist: vehUnits.dist || "km", vol: vehUnits.vol || "l", sure: !!vehUnits.dist };
    var cats = {}, cc = sec(secs, /^costcategories$/);
    if (cc) cc.rows.forEach(function (row) {
      var o = objOf(cc.head, row);
      cats[K.clean(K.get(o, ["CostTypeID", "Id"]), 20)] = K.clean(K.get(o, ["Name"]), 60);
    });
    var costs = sec(secs, /^costs$/);
    if (costs) otherBlock(res, costs.head, costs.rows, "", {
      vk: vk,
      text: function (r) {
        var cn = cats[K.clean(K.get(r, ["CostTypeID"]), 20)] || "";
        return K.clean((cn ? cn + ": " : "") + K.get(r, ["CostTitle"]), 200);
      }
    });
    return finish(res);
  }

  function parseDrivvo(secs) {
    var res = out("drivvo"), any = false;
    secs.forEach(function (s) {
      var k = secKind(s.name);
      if (!k) return;
      any = true;
      if (k === "i") { res.skipped.income += s.rows.length; return; }
      var u = unitsOf(s.head);
      if (!res.units.dist && u.dist) res.units.dist = u.dist;
      if (!res.units.vol && u.vol) res.units.vol = u.vol;
      if (k === "f") fuelBlock(res, s.head, s.rows, {});
      else otherBlock(res, s.head, s.rows, k === "s" ? "s" : "");
    });
    if (!any) return { error: "bad" };
    res.units = { dist: res.units.dist || "km", vol: res.units.vol || "l", sure: !!(res.units.dist && res.units.vol) };
    return finish(res);
  }

  // LubeLogger: guess the units from FuelEconomy against the data
  // (l/100km = metric; a distance-per-volume figure = mpg, imperial)
  function lubeUnits(recs) {
    var full = recs.filter(function (r) { return r.k === "f" && r.odo !== null && r.vol > 0; })
      .sort(function (a, b) { return a.odo - b.odo; });
    var per = 0, l100 = 0;
    for (var i = 1; i < full.length; i++) {
      var dist = full[i].odo - full[i - 1].odo, e = full[i].econ;
      if (!(dist > 0) || !(e > 0)) continue;
      var a = dist / full[i].vol, b = full[i].vol * 100 / dist;
      if (Math.abs(a - e) / e < 0.2) per++;
      else if (Math.abs(b - e) / e < 0.2) l100++;
    }
    if (l100 > per) return { dist: "km", vol: "l", sure: false };
    return { dist: "mi", vol: "usgal", sure: false };
  }

  function parseCsv(text, name) {
    var recs = K.records(text, { maxRows: MAX_RECS });
    var head = recs.head;
    if (!head.length || K.col(head, H.date) === -1) return { error: "bad" };
    var rows = recs.rows.map(function (o) { return head.map(function (h) { return o[h]; }); });
    var fname = low(name);
    var u = unitsOf(head);
    var res;
    if (K.col(head, ["fuelconsumed"]) !== -1 && K.col(head, ["isfilltofull"]) !== -1) {
      res = out("lubelogger");
      var vk = res.veh({ key: "", name: "" });
      fuelBlock(res, head, rows, { vk: vk, extra: function (r, rec) { rec.econ = numOr(K.get(r, ["fueleconomy"])); } });
      res.units = u.dist && u.vol ? { dist: u.dist, vol: u.vol, sure: false } : lubeUnits(res.recs);
      res.recs.forEach(function (r) { delete r.econ; });
      return finish(res);
    }
    if (K.col(head, ["fuelup_date"]) !== -1 || (K.col(head, ["car_name"]) !== -1 && K.col(head, ["mpg", "gallons"]) !== -1)) {
      res = out("fuelly");
      // Fuelly: "price" is the price per gallon (or litre)
      fuelBlock(res, head, rows, { priceUnit: K.col(head, ["price"]) !== -1 && K.col(head, ["total", "total cost", "total_price"]) === -1 });
      var mi = K.col(head, ["miles"]) !== -1 || K.col(head, ["mpg"]) !== -1, gal = K.col(head, ["gallons"]) !== -1;
      res.units = { dist: mi ? "mi" : (u.dist || "km"), vol: gal ? "usgal" : (u.vol || "l"), sure: false };
      return finish(res);
    }
    var acar = K.col(head, ["odometer reading"]) !== -1 || K.col(head, ["partial fill-up?", "previous missed fill-ups?", "price per volume unit"]) !== -1;
    var lube = !acar && K.col(head, ["description"]) !== -1 && K.col(head, ["tags"]) !== -1 && K.col(head, ["odometer"]) !== -1;
    var drivvo = K.col(head, ["full tank", "tanque cheio", "tanque lleno", "price/l", "gas station", "posto", "odômetro", "expense type", "service type", "tipo de despesa", "tipo de serviço"]) !== -1;
    res = out(acar ? "acar" : (lube ? "lubelogger" : (drivvo ? "drivvo" : "csv")));
    var isFuel = hasCol(head, "vol") || (K.col(head, ["fuel"]) !== -1 && hasCol(head, "unit"));
    if (isFuel) fuelBlock(res, head, rows, {});
    else if (K.col(head, H.total) !== -1) {
      // LubeLogger / Drivvo: one file per kind, told by its name
      var kind = "", cat = "";
      if (/upgrade/.test(fname)) { kind = "c"; cat = "acc"; }
      else if (/tax/.test(fname)) { kind = "c"; cat = "tax"; }
      else if (/suppl/.test(fname)) { kind = "c"; cat = "parts"; }
      else if (/servic|repair|maint/.test(fname) || K.col(head, ["service type", "tipo de serviço", "services"]) !== -1) kind = "s";
      else if (/expense|cost|despesa/.test(fname) || K.col(head, ["expense type", "tipo de despesa"]) !== -1) kind = "";
      else if (lube) kind = "s";
      otherBlock(res, head, rows, kind, { cat: cat });
    } else return { error: "bad" };
    res.units = { dist: u.dist || "km", vol: u.vol || "l", sure: !!(u.dist && u.vol) };
    return finish(res);
  }

  function parseText(text, name) {
    text = str(text);
    if (text.length > MAX_TEXT) return { error: "big" };
    var t0 = text.replace(/^﻿/, "").replace(/^\s+/, "");
    if (!t0) return { error: "empty" };
    if (t0.charAt(0) === "{" || t0.charAt(0) === "[" || t0.charAt(0) === "<") return { error: "bad" };
    var first = K.clean(t0.split(/\r?\n/, 1)[0].replace(/"/g, "").split(/[,;\t|]/)[0], 80);
    if (/^#/.test(first) || secKind(first)) {
      var secs = sections(t0);
      if (sec(secs, /^log$/) || sec(secs, /^vehicle$/)) return parseFuelio(secs, name);
      return parseDrivvo(secs);
    }
    return parseCsv(t0, name || "");
  }

  function readBytes(bytes, name) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (!K.isZip(bytes)) {
      var txt;
      try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
      return Promise.resolve(parseText(txt, name));
    }
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    var names = z.names.filter(function (n) { return /\.csv$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); }).slice(0, MAX_ZIP_ENTRIES);
    var results = [];
    return names.reduce(function (p, n) {
      return p.then(function () {
        return z.text(n, MAX_TEXT).then(function (s) {
          var r = parseText(s, n);
          if (!r.error) results.push(r);
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      if (!results.length) return { error: names.length ? "empty" : "bad" };
      return combine(results);
    });
  }
  // several files: vehicles by key (a file with no vehicle of its
  // own joins the first one), the first sure units win
  function combine(list) {
    if (list.length === 1) return list[0];
    var res = { source: list[0].source, vehicles: [], recs: [], units: null, skipped: { income: 0, bad: 0 } };
    list.forEach(function (r) {
      r.vehicles.forEach(function (v) {
        if (v.key && !res.vehicles.some(function (x) { return x.key === v.key; }) && res.vehicles.length < MAX_VEH) res.vehicles.push(v);
      });
      if (r.source !== "csv" && res.source === "csv") res.source = r.source;
      if (!res.units || (!res.units.sure && r.units.sure)) res.units = r.units;
      res.skipped.income += r.skipped.income;
      res.skipped.bad += r.skipped.bad;
    });
    if (!res.vehicles.length) res.vehicles.push(list[0].vehicles[0]);
    var keys = res.vehicles.map(function (v) { return v.key; });
    list.forEach(function (r) {
      r.recs.forEach(function (x) {
        if (res.recs.length >= MAX_RECS) return;
        if (keys.indexOf(x.vk) < 0) x.vk = keys[0];
        res.recs.push(x);
      });
    });
    return res;
  }

  // ---------- 6. Plan against the current data ----------
  function hid(s) {
    var a = K.hash(s), b = K.hash("~" + s);
    return ("imp" + a + b + "000000").slice(0, Math.max(6, 3 + a.length + b.length)).slice(0, 40);
  }
  function newVehicleId(res, vk) {
    var v = vehicleOf(res, vk), tag = v ? v.name + "|" + v.plate : "";
    if (!v || !v.name) {
      // a file with no vehicle name: told apart by its first record
      var f = (res.recs || [])[0];
      tag = f ? f.d + "|" + f.odo : "";
    }
    return hid("veh|" + res.source + "|" + vk + "|" + tag);
  }
  function vehicleOf(res, vk) {
    var vs = res.vehicles || [];
    for (var i = 0; i < vs.length; i++) if (vs[i].key === vk) return vs[i];
    return vs[0] || null;
  }
  // which existing vehicle the file most likely means: one made by an
  // earlier import of this file, else one with the same name / plate
  function guessVehicle(res, vk, data) {
    var list = (data && data.vehicles) || [];
    var id = newVehicleId(res, vk), v = vehicleOf(res, vk);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return id;
    if (v && v.plate) { var p = C.matchVehicle(list, v.plate); if (p) return p.id; }
    if (v && v.name) { var n = C.matchVehicle(list, v.name); if (n) return n.id; }
    return "";
  }
  function cents(x) { return x !== null && isFinite(x) && x > 0 ? Math.round(x * 100) : 0; }

  // The fallback name of a new vehicle (garage.js passes its own
  // t("imp.newName") as opts.newName; same key and English).
  var NEW_NAME = {
    en: { "imp.newName": "Imported vehicle" },
    el: { "imp.newName": "Εισαγόμενο όχημα" }
  };
  function plan(res, data, opts) {
    opts = opts || {};
    var vk = opts.vk !== undefined ? opts.vk : ((res.vehicles && res.vehicles[0]) || {}).key || "";
    var dist = opts.dist === "mi" ? "mi" : "km";
    var vol = has(VOL, opts.vol) ? opts.vol : "l";
    var lang = opts.lang === "el" ? "el" : "en";
    var src = vehicleOf(res, vk) || {};
    var vid = opts.vid || "", veh = null, vehicle = null;
    if (vid) (data.vehicles || []).forEach(function (v) { if (v.id === vid) veh = v; });
    if (!veh) {
      vid = newVehicleId(res, vk);
      (data.vehicles || []).forEach(function (v) { if (v.id === vid) veh = v; });
    }
    if (!veh) {
      var type = "car", fuel = has(C.FUELS, src.fuel) && src.fuel ? src.fuel : "petrol";
      var nm = src.name || [src.make, src.model].filter(Boolean).join(" ") || opts.newName || NEW_NAME[lang]["imp.newName"];
      vehicle = C.normVehicle({
        id: vid, m: 0, name: nm, type: type, fuel: fuel, make: src.make || "", model: src.model || "",
        year: src.year || 0, plate: src.plate || "", tank: vol === "l" ? (src.tank || 0) : Math.round((src.tank || 0) * VOL[vol]),
        col: ((data.vehicles || []).length) % 8, arch: 0, notes: ""
      });
      veh = vehicle;
    }
    var allowed = C.itemsFor(veh.type);
    var energies = C.energies(veh);
    var mine = { fuel: [], service: [], costs: [] };
    ["fuel", "service", "costs"].forEach(function (k) {
      ((data && data[k]) || []).forEach(function (x) { if (x.v === vid) mine[k].push(x); });
    });
    var st = { fuel: 0, full: 0, partial: 0, missed: 0, service: 0, costs: 0, cats: {}, dup: 0, from: "", to: "",
               skipped: { twice: 0, noKm: 0, noQty: 0, zero: 0, noFuel: 0, bad: res.skipped ? res.skipped.bad : 0, income: res.skipped ? res.skipped.income : 0 } };
    var outR = { fuel: [], service: [], costs: [] };
    // a match among the file's own rows is a repeat in the file, one
    // among the vehicle's rows is "already there"
    function dupOf(list, k, same) {
      if (outR[k].some(same)) { st.skipped.twice++; return true; }
      if (list.some(same)) { st.dup++; return true; }
      return false;
    }
    function kmOf(o) {
      if (o === null || o === undefined || !isFinite(o)) return null;
      var km = Math.round(dist === "mi" ? o * MI : o);
      return km >= 0 && km <= C.KM_MAX ? km : null;
    }
    function near(a, b, tol) { return a === null || b === null ? a === b : Math.abs(a - b) <= tol; }
    function seen(r) {
      if (!st.from || r.d < st.from) st.from = r.d;
      if (!st.to || r.d > st.to) st.to = r.d;
    }
    (res.recs || []).forEach(function (r) {
      if ((res.vehicles || []).length > 1 && r.vk !== vk) return;
      var km = kmOf(r.odo), row, id;
      if (r.k === "f") {
        if (!energies.length) { st.skipped.noFuel++; return; }
        var e = energies.length === 1 ? energies[0] : (r.tank === 2 || fuelOf(r.ft) === "ev" ? "e" : "f");
        if (energies.indexOf(e) < 0) e = energies[0];
        if (km === null) { st.skipped.noKm++; return; }
        var q = r.vol > 0 ? Math.round(r.vol * (e === "e" ? 1 : VOL[vol]) * 1000) : 0;
        if (q < 1 || q > C.Q_MAX) { st.skipped.noQty++; return; }
        var c = cents(r.cost);
        id = hid(vid + "|f|" + r.d + "|" + km + "|" + q + "|" + c);
        row = C.normFuel({ id: id, m: 0, v: vid, d: r.d, km: km, q: q, c: c, e: e, full: r.full ? 1 : 0, mis: r.mis ? 1 : 0, st: r.st, n: r.n, bud: 0 });
        if (!row) { st.skipped.bad++; return; }
        if (dupOf(mine.fuel, "fuel", function (x) {
          return x.id === id || (x.d === row.d && x.e === row.e && near(x.km, row.km, 1) &&
            (x.c && row.c ? Math.abs(x.c - row.c) <= 1 : Math.abs(x.q - row.q) <= Math.max(10, row.q * 0.005)));
        })) return;
        outR.fuel.push(row);
        st.fuel++;
        if (row.mis) st.missed++;
        if (row.full) st.full++; else st.partial++;
        seen(row);
        return;
      }
      var cc = cents(r.cost);
      var note = K.cleanText([r.text, r.n].filter(Boolean).join("\n"), 500);
      if (r.k === "s") {
        var items = r.items ? [r.items] : itemsOf(r.text + " " + r.n, allowed);
        id = hid(vid + "|s|" + r.d + "|" + km + "|" + cc + "|" + low(r.text));
        row = C.normService({ id: id, m: 0, v: vid, d: r.d, km: km, items: items, c: cc, shop: r.shop, n: note, bud: 0 });
        if (!row) { st.skipped.bad++; return; }
        if (dupOf(mine.service, "service", function (x) { return x.id === id || (x.d === row.d && near(x.km, row.km, 1) && x.c === row.c); })) return;
        outR.service.push(row);
        st.service++;
        seen(row);
        return;
      }
      if (cc < 1) { st.skipped.zero++; return; }
      var cat = r.cat || catOf(r.text);
      id = hid(vid + "|c|" + r.d + "|" + km + "|" + cc + "|" + cat);
      row = C.normCost({ id: id, m: 0, v: vid, d: r.d, cat: cat, c: cc, km: km, n: note, bud: 0 });
      if (!row) { st.skipped.bad++; return; }
      if (dupOf(mine.costs, "costs", function (x) { return x.id === id || (x.d === row.d && near(x.km, row.km, 1) && x.c === row.c); })) return;
      outR.costs.push(row);
      st.costs++;
      st.cats[cat] = (st.cats[cat] || 0) + 1;
      seen(row);
    });
    return { vid: vid, vehicle: vehicle, fuel: outR.fuel, service: outR.service, costs: outR.costs, stats: st };
  }

  var API = {
    MAX_FILE: MAX_FILE, parseText: parseText, readBytes: readBytes, plan: plan,
    guessVehicle: guessVehicle, newVehicleId: newVehicleId,
    catOf: catOf, itemsOf: itemsOf, fuelOf: fuelOf, unitsOf: unitsOf, dkey: dkey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosGarageImport = API;
})(typeof self !== "undefined" ? self : this);
