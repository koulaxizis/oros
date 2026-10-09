// ============================================================
// orOS Calendar — namedays.js (Greek name days, public holidays,
// observances; v1.0.0)
// Pure functions, no DOM, no network, no storage. Loaded by
// calendar/index.html before calendar.js; the Node tests require
// it directly (tests/namedays.test.js).
//
// Dates are local calendar days "YYYY-MM-DD"; day arithmetic runs
// on whole UTC days, so a daylight-saving change never moves a day.
//
// Sources: the Greek Orthodox church calendar and Greek public
// holiday law (facts, written here by hand, not copied from any
// third-party dataset). Movable feasts follow Orthodox Easter
// (Meeus' Julian computus + 13 days, valid 1900-2099).
//
// API (window.OrosNamedays):
//   easter(year)                → "YYYY-MM-DD" (Orthodox)
//   holidaysOn(ymd)             → [{ id, en, el }]
//   namesOn(ymd)                → ["Γεώργιος", "Γιώργος", ...] (display)
//   keysOn(ymd)                 → { skeleton: true } (for matching)
//   skeleton(name)              → match key (Greek or Latin input)
//   celebrates(givenName, ymd)  → bool
//   cleanDays(json)             → sanitized observances data | null
//   observancesOn(ymd, data)    → [{ id, en, el }]
// ============================================================
(function (root) {
  "use strict";

  /* ---------- 1. Day arithmetic ---------- */
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function isYmd(s) { return typeof s === "string" && YMD_RE.test(s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayNum(ymd) {
    var p = ymd.split("-");
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function ymdFromDay(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function addDays(ymd, n) { return ymdFromDay(dayNum(ymd) + n); }
  // 0 = Sunday … 6 = Saturday
  function weekday(ymd) { return ((dayNum(ymd) % 7) + 7 + 4) % 7; }

  /* ---------- 2. Orthodox Easter ---------- */
  var easterCache = {};
  function easter(year) {
    if (easterCache[year]) return easterCache[year];
    var a = year % 4, b = year % 7, c = year % 19;
    var d = (19 * c + 15) % 30;
    var e = (2 * a + 4 * b - d + 34) % 7;
    var month = Math.floor((d + e + 114) / 31);     // Julian calendar
    var day = ((d + e + 114) % 31) + 1;
    var out = addDays(year + "-" + pad(month) + "-" + pad(day), 13);
    easterCache[year] = out;
    return out;
  }
  // Days from Orthodox Easter of the same year (negative = before).
  function fromEaster(ymd) { return dayNum(ymd) - dayNum(easter(+ymd.slice(0, 4))); }

  /* ---------- 3. Greek public holidays ---------- */
  var HOLIDAYS_FIXED = {
    "01-01": ["newyear", "New Year's Day", "Πρωτοχρονιά"],
    "01-06": ["epiphany", "Epiphany", "Θεοφάνια"],
    "03-25": ["mar25", "Independence Day / Annunciation", "25η Μαρτίου (Ευαγγελισμός)"],
    "05-01": ["may1", "Labour Day", "Πρωτομαγιά"],
    "08-15": ["aug15", "Dormition of the Virgin Mary", "Κοίμηση της Θεοτόκου"],
    "10-28": ["oct28", "Ochi Day", "Επέτειος του «Όχι»"],
    "12-25": ["xmas", "Christmas Day", "Χριστούγεννα"],
    "12-26": ["xmas2", "Synaxis of the Theotokos", "Σύναξη της Θεοτόκου"]
  };
  var HOLIDAYS_EASTER = {
    "-48": ["cleanmon", "Clean Monday", "Καθαρά Δευτέρα"],
    "-2": ["goodfri", "Good Friday", "Μεγάλη Παρασκευή"],
    "0": ["easter", "Easter Sunday", "Κυριακή του Πάσχα"],
    "1": ["eastermon", "Easter Monday", "Δευτέρα του Πάσχα"],
    "50": ["whitmon", "Whit Monday", "Αγίου Πνεύματος"]
  };
  function holidaysOn(ymd) {
    if (!isYmd(ymd)) return [];
    var out = [];
    var f = HOLIDAYS_FIXED[ymd.slice(5)];
    if (f) out.push({ id: f[0], en: f[1], el: f[2] });
    var m = HOLIDAYS_EASTER[String(fromEaster(ymd))];
    if (m) out.push({ id: m[0], en: m[1], el: m[2] });
    return out;
  }

  /* ---------- 4. Name days ----------
     One string per feast: forms joined by "|". A form starting with
     "~" is a nickname used only for matching (never displayed). */
  var NAMES_FIXED = {
    "01-01": "Βασίλειος|Βασίλης|Βασιλική|Βάσω|~Βασιλάκης",
    "01-02": "Σεραφείμ|Σίλβεστρος",
    "01-06": "Φώτιος|Φώτης|Φωτεινή|Φωτούλα|Θεοφάνης|Φάνης|Θεοφανία|Φανή|Ιορδάνης",
    "01-07": "Ιωάννης|Γιάννης|Ιωάννα|Γιάννα|Πρόδρομος|~Γιαννάκης|~Νάνα",
    "01-11": "Θεοδόσιος|Θεοδοσία",
    "01-12": "Τατιανή|Τατιάνα",
    "01-17": "Αντώνιος|Αντώνης|Αντωνία|Τόνια",
    "01-18": "Αθανάσιος|Θανάσης|Αθανασία|Νάσος|Κύριλλος",
    "01-20": "Ευθύμιος|Θύμιος|Ευθυμία",
    "01-21": "Μάξιμος|Νεόφυτος|Αγνή",
    "01-22": "Τιμόθεος",
    "01-24": "Ξένη|Ξένια",
    "01-25": "Γρηγόριος|Γρηγόρης|Γρηγορία",
    "02-01": "Τρύφων",
    "02-03": "Συμεών",
    "02-10": "Χαράλαμπος|Χάρης|Μπάμπης|Λάμπης|Χαραλαμπία",
    "02-11": "Βλάσιος|Βλάσης",
    "02-12": "Μελέτιος|Μελέτης",
    "02-23": "Πολύκαρπος",
    "03-25": "Ευάγγελος|Βαγγέλης|Ευαγγελία|Βαγγελιώ",
    "04-16": "Λεωνίδας",
    "05-05": "Ειρήνη|Ρένα",
    "05-11": "Κύριλλος|Μεθόδιος",
    "05-13": "Γλυκερία",
    "05-21": "Κωνσταντίνος|Κώστας|Ντίνος|Κωστής|Κωνσταντίνα|Ντίνα|Κωνσταντία|Ελένη|Έλενα|Λένα|Ελένα|~Κωστάκης",
    "06-08": "Καλλιόπη|Πόπη",
    "06-11": "Βαρθολομαίος|Βαρνάβας",
    "06-29": "Πέτρος|Παύλος|Παυλίνα|Πέτρα",
    "07-01": "Κοσμάς|Δαμιανός",
    "07-07": "Κυριακή|Κική",
    "07-11": "Ευφημία|Έφη",
    "07-17": "Μαρίνα",
    "07-20": "Ηλίας|Ηλιάνα",
    "07-22": "Μαγδαληνή|Μαγδαλένα|Μαρκέλλα",
    "07-24": "Χριστίνα",
    "07-25": "Άννα|Αννούλα",
    "07-26": "Παρασκευή|Παρασκευάς|Βιβή|Εύη",
    "07-27": "Παντελεήμων|Παντελής|Παντελεήμονας",
    "08-06": "Σωτήριος|Σωτήρης|Σωτηρία",
    "08-15": "Μαρία|Μαρίκα|Μαίρη|Μαριάννα|Μαριλένα|Μαρούλα|Παναγιώτης|Πάνος|Παναγής|Παναγιώτα|Γιώτα|Δέσποινα",
    "08-26": "Αδριανός|Ναταλία",
    "08-27": "Φανούριος|Φανούρης",
    "08-30": "Αλέξανδρος|Αλέκος|Αλέξης|Αλεξάνδρα|Αλεξία",
    "08-31": "Αριστείδης",
    "09-05": "Ζαχαρίας",
    "09-14": "Σταύρος|Σταυρούλα|Σταυριανή",
    "09-17": "Σοφία|Αγάπη|Ελπίδα|Ελπίς|Πίστη",
    "09-20": "Ευστάθιος|Στάθης",
    "09-24": "Θέκλα",
    "09-29": "Κυριάκος",
    "10-03": "Διονύσιος|Διονύσης",
    "10-13": "Χρυσή|Χρυσούλα|Χρυσάνθη",
    "10-18": "Λουκάς",
    "10-19": "Κλεοπάτρα",
    "10-20": "Αρτέμιος|Αρτέμης|Αρτεμισία|Γεράσιμος",
    "10-23": "Ιάκωβος|Ιακώβα",
    "10-26": "Δημήτριος|Δημήτρης|Δήμος|Δήμητρα|Μήτσος|Μίμης|~Δημητράκης",
    "11-01": "Κοσμάς|Δαμιανός",
    "11-08": "Μιχαήλ|Μιχάλης|Μιχαέλα|Γαβριήλ|Γαβριέλα|Άγγελος|Αγγελική|Αγγελίνα|Ταξιάρχης|Ραφαήλ|~Μιχαλάκης",
    "11-09": "Νεκτάριος|Νεκταρία",
    "11-11": "Μηνάς",
    "11-13": "Χρυσόστομος",
    "11-14": "Φίλιππος|Φιλίππα",
    "11-16": "Ματθαίος",
    "11-25": "Αικατερίνη|Κατερίνα|Κατίνα|Κάτια|~Κατερινιώ",
    "11-26": "Στυλιανός|Στέλιος|Στυλιανή|Στέλλα",
    "11-30": "Ανδρέας|Αντρέας|Ανδριανή",
    "12-04": "Βαρβάρα",
    "12-05": "Σάββας",
    "12-06": "Νικόλαος|Νίκος|Νικολέτα|Νικολίνα|~Νικολάκης",
    "12-09": "Άννα|Αννούλα",
    "12-12": "Σπυρίδων|Σπύρος|Σπυριδούλα",
    "12-13": "Ευστράτιος|Στράτος|Λουκία",
    "12-15": "Ελευθέριος|Λευτέρης|Ελευθερία",
    "12-16": "Θεοφανώ",
    "12-17": "Δανιήλ",
    "12-20": "Ιγνάτιος",
    "12-22": "Αναστασία",
    "12-24": "Ευγενία|Ευγένιος",
    "12-25": "Χρήστος|Χριστόφορος|Χριστόδουλος",
    "12-26": "Εμμανουήλ|Μανώλης|Μανόλης|Εμμανουέλα|Ιωσήφ|Δαβίδ",
    "12-27": "Στέφανος|Στεφανία|Στέφανη"
  };
  // Movable feasts: days from Orthodox Easter.
  var NAMES_EASTER = {
    "-43": "Θεόδωρος|Θοδωρής|Θεοδώρα|Δώρα|Ντόρα",       // Saturday of St Theodore
    "-8": "Λάζαρος",                                      // Lazarus Saturday
    "-7": "Βάιος|Βάια",                                   // Palm Sunday
    "0": "Αναστάσιος|Τάσος|Αναστασία|Λάμπρος|Λαμπρινή|Πασχάλης|Πασχαλία",
    "2": "Ραφαήλ",                                        // Bright Tuesday
    "5": "Ζωή|Πηγή|Ζήσης",                                // Life-giving Spring
    "7": "Θωμάς|Θωμαΐς",                                  // Thomas Sunday
    "49": "Τριαντάφυλλος|Τριανταφυλλιά|Τριάδα"             // Pentecost
  };
  // George (23 Apr) and Mark (25 Apr) never fall in Lent: on or
  // before Easter (Easter Monday for Mark) they move after it.
  var GEORGE = "Γεώργιος|Γιώργος|Γιώργης|Γεωργία|Γιωργία|Γωγώ|~Γιωργάκης";
  var MARK = "Μάρκος";

  function feastsOn(ymd) {
    if (!isYmd(ymd)) return [];
    var out = [];
    var mmdd = ymd.slice(5), year = ymd.slice(0, 4);
    if (NAMES_FIXED[mmdd]) out.push(NAMES_FIXED[mmdd]);
    var off = fromEaster(ymd);
    if (NAMES_EASTER[String(off)]) out.push(NAMES_EASTER[String(off)]);
    var e = easter(+year);
    var george = year + "-04-23", mark = year + "-04-25";
    var georgeDay = george <= e ? addDays(e, 1) : george;
    var markDay = mark <= addDays(e, 1) ? addDays(e, 2) : mark;
    if (ymd === georgeDay) out.push(GEORGE);
    if (ymd === markDay) out.push(MARK);
    return out;
  }

  function namesOn(ymd) {
    var seen = {}, out = [];
    feastsOn(ymd).forEach(function (f) {
      f.split("|").forEach(function (n) {
        if (n.charAt(0) === "~" || seen[n]) return;
        seen[n] = true;
        out.push(n);
      });
    });
    return out;
  }

  /* ---------- 5. Name matching (Greek or Greeklish) ----------
     Both sides fold to a Latin "skeleton": accents off, Greek
     transliterated, common Greeklish spellings unified, doubled
     letters squeezed. "Γιώργος" = "Giorgos", "Χρήστος" = "Christos",
     "Βασίλης" = "Vassilis". */
  var GR_DI = [["ου", "u"], ["ευ", "ev"], ["αυ", "av"], ["ει", "i"], ["οι", "i"],
               ["αι", "e"], ["γγ", "ng"], ["γκ", "g"], ["μπ", "b"], ["ντ", "d"], ["τζ", "tz"]];
  var GR_ONE = { α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i",
                 κ: "k", λ: "l", μ: "m", ν: "n", ξ: "ks", ο: "o", π: "p", ρ: "r", σ: "s",
                 τ: "t", υ: "i", φ: "f", χ: "h", ψ: "ps", ω: "o" };
  var LAT_DI = [["ch", "h"], ["kh", "h"], ["ph", "f"], ["ou", "u"], ["ei", "i"], ["oi", "i"],
                ["ai", "e"], ["x", "ks"], ["y", "i"], ["w", "o"], ["c", "k"]];
  function skeleton(name) {
    if (typeof name !== "string") return "";
    var s = name.trim().split(/[\s,.\-]+/)[0] || "";
    s = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");
    var i;
    if (/[α-ω]/.test(s)) {
      for (i = 0; i < GR_DI.length; i++) s = s.split(GR_DI[i][0]).join(GR_DI[i][1]);
      s = s.replace(/[α-ω]/g, function (ch) { return GR_ONE[ch]; });
    } else {
      for (i = 0; i < LAT_DI.length; i++) s = s.split(LAT_DI[i][0]).join(LAT_DI[i][1]);
    }
    s = s.replace(/[^a-z]/g, "");
    return s.replace(/(.)\1+/g, "$1");
  }

  var keysCache = {};
  function keysOn(ymd) {
    if (keysCache[ymd]) return keysCache[ymd];
    var keys = {};
    feastsOn(ymd).forEach(function (f) {
      f.split("|").forEach(function (n) {
        var k = skeleton(n.replace(/^~/, ""));
        if (k) keys[k] = true;
      });
    });
    keysCache[ymd] = keys;
    return keys;
  }
  function celebrates(given, ymd) {
    var k = skeleton(given);
    return !!(k && keysOn(ymd)[k]);
  }

  /* ---------- 6. Observances (calendar/days.json) ----------
     Data, not code: each entry is one rule.
       { id, en, el, md: "MM-DD" }                     fixed date
       { id, en, el, nth: [month, weekday, n] }        n-th weekday
            (weekday 0 = Sunday; n = -1 → last of the month)
       { id, en, el, easter: offset }                  from Orthodox Easter
       { id, en, el, doy: n }                          n-th day of the year
     Anything else is dropped. Titles are plain text (rendered with
     textContent), trimmed to 80 characters. */
  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var MAX_DAYS = 1000;
  function cleanTitle(s) {
    return (typeof s === "string") ? s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
  }
  function cleanDays(json) {
    if (!json || typeof json !== "object" || json.ver !== 1 || !Array.isArray(json.days)) return null;
    var out = [], seen = {};
    for (var i = 0; i < json.days.length && out.length < MAX_DAYS; i++) {
      var d = json.days[i];
      if (!d || typeof d !== "object" || !ID_RE.test(d.id || "") || seen[d.id]) continue;
      var en = cleanTitle(d.en), el = cleanTitle(d.el);
      if (!en || !el) continue;
      var r = { id: d.id, en: en, el: el };
      if (typeof d.md === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d.md)) r.md = d.md;
      else if (Array.isArray(d.nth) && d.nth.length === 3 &&
               d.nth[0] >= 1 && d.nth[0] <= 12 && d.nth[1] >= 0 && d.nth[1] <= 6 &&
               [1, 2, 3, 4, 5, -1].indexOf(d.nth[2]) !== -1 &&
               d.nth.every(function (x) { return x === Math.floor(x); })) r.nth = d.nth.slice();
      else if (typeof d.easter === "number" && d.easter === Math.floor(d.easter) &&
               Math.abs(d.easter) <= 100) r.easter = d.easter;
      else if (typeof d.doy === "number" && d.doy === Math.floor(d.doy) &&
               d.doy >= 1 && d.doy <= 366) r.doy = d.doy;
      else continue;
      seen[d.id] = true;
      out.push(r);
    }
    return { ver: 1, updated: isYmd(json.updated) ? json.updated : "", days: out };
  }

  function nthWeekday(year, month, wd, n) {
    var first = year + "-" + pad(month) + "-01";
    if (n > 0) {
      var d = addDays(first, (wd - weekday(first) + 7) % 7 + 7 * (n - 1));
      return +d.slice(5, 7) === month ? d : null;
    }
    var last = addDays(month === 12 ? (year + 1) + "-01-01" : year + "-" + pad(month + 1) + "-01", -1);
    return addDays(last, -((weekday(last) - wd + 7) % 7));
  }

  // Per (data, year) index: ymd → [entries]. Rebuilt when the data
  // object changes (a fresh download) or another year is asked.
  var obsIdx = { data: null, years: {} };
  function obsYear(data, year) {
    if (obsIdx.data !== data) obsIdx = { data: data, years: {} };
    if (obsIdx.years[year]) return obsIdx.years[year];
    var map = {}, e = easter(year), jan1 = year + "-01-01";
    data.days.forEach(function (r) {
      var at = null;
      if (r.md) at = (r.md === "02-29" && !isYmd(year + "-02-29")) ? null : year + "-" + r.md;
      else if (r.nth) at = nthWeekday(year, r.nth[0], r.nth[1], r.nth[2]);
      else if (typeof r.easter === "number") at = addDays(e, r.easter);
      else if (r.doy) at = addDays(jan1, r.doy - 1);
      if (!at || at.slice(0, 4) !== String(year)) return;
      (map[at] = map[at] || []).push({ id: r.id, en: r.en, el: r.el });
    });
    obsIdx.years[year] = map;
    return map;
  }
  function observancesOn(ymd, data) {
    if (!isYmd(ymd) || !data || !Array.isArray(data.days)) return [];
    return (obsYear(data, +ymd.slice(0, 4))[ymd] || []).slice();
  }

  var api = {
    isYmd: isYmd, addDays: addDays, weekday: weekday, easter: easter,
    holidaysOn: holidaysOn, namesOn: namesOn, keysOn: keysOn,
    skeleton: skeleton, celebrates: celebrates,
    cleanDays: cleanDays, observancesOn: observancesOn, nthWeekday: nthWeekday,
    _NAMES_FIXED: NAMES_FIXED, _NAMES_EASTER: NAMES_EASTER
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosNamedays = api;
})(typeof window !== "undefined" ? window : this);
