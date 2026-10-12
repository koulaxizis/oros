// ============================================================
// orOS Unit Converter — pure core (no DOM)
// Categories, units, conversion, number input and output, the
// synced data merge, currency rates and the "10 km to mi" query
// parser used by the universal search.
//
//   Data   { ver, favs: { id: fav }, recent: { id: rec }, prec, tombs }
//   fav    { c: category, f: from unit, t: to unit, m: ms }
//          id "c:f>t" (deterministic, R16: two devices that star
//          the same pair converge on one favourite)
//   rec    { c, f, t, v: value typed (number), i?: ingredient, m: ms }
//          id "c:f>t=v" (+ "@i" for Cooking cups ⇄ grams); at most
//          RECENT_MAX kept (newest m, then id)
//   prec   { v: significant digits 2-12, m: ms } (LWW), or null
//   tombs  { id: ms } favourites and recents removed (R17); a newer
//          entry resurrects; at most TOMBS_MAX kept (newest)
//   Rates  (device-local, R10) { base: "EUR", date: "YYYY-MM-DD",
//          at: ms fetched, src, rates: { USD: 1.08, ... } }
//
// Every factor converts the unit to its category's base unit
// (length m, mass kg, volume L, area m², speed m/s, time s, data
// byte, pressure Pa, energy J, power W, angle degree, currency EUR).
// Temperature and fuel consumption use functions.
// Definitions are exact where a definition exists (1 in = 0.0254 m,
// 1 lb = 0.45359237 kg, 1 US gal = 3.785411784 L, ...).
//
// Used by the app (units/units.js), its search provider and the
// tests. UMD: module.exports in Node, window.UnitsCore in a browser.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER   = 1;
  var RECENT_MAX = 20;
  var TOMBS_MAX  = 300;
  var PREC_DEF   = 6;
  var PREC_MIN   = 2;
  var PREC_MAX   = 12;
  var PREFS_KEY  = "oros-units-prefs";
  var RATES_KEY  = "oros-units-rates";
  var DATA_KEY   = "oros-units-data";
  var RATES_URLS = ["https://api.frankfurter.dev/v1/latest", "https://api.frankfurter.app/latest"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- Categories + units ----------
  // u: [id, factor, symbol, EN name, EL name, group, extra aliases]
  // group: "m" metric (SI), "i" imperial / US, "o" other
  // Extra aliases are "|"-separated (plural forms, other spellings).
  var CATS = [
    { id: "length", base: "m", en: "Length", el: "Μήκος", def: ["km", "mi"], u: [
      ["nm",  1e-9,       "nm",  "Nanometre",  "Νανόμετρο",   "m", "nanometer|nanometers|νανόμετρα"],
      ["um",  1e-6,       "µm",  "Micrometre", "Μικρόμετρο",  "m", "μm|micron|micrometer|micrometers|μικρά|μικρόμετρα"],
      ["mm",  0.001,      "mm",  "Millimetre", "Χιλιοστό",    "m", "millimeter|millimeters|χιλιοστά|χιλιοστόμετρο"],
      ["cm",  0.01,       "cm",  "Centimetre", "Εκατοστό",    "m", "centimeter|centimeters|εκατοστά|πόντος|πόντοι|εκ"],
      ["dm",  0.1,        "dm",  "Decimetre",  "Δεκατόμετρο", "m", "decimeter|decimeters|δεκατόμετρα"],
      ["m",   1,          "m",   "Metre",      "Μέτρο",       "m", "meter|meters|metres|μέτρα|μ"],
      ["km",  1000,       "km",  "Kilometre",  "Χιλιόμετρο",  "m", "kilometer|kilometers|kilometres|χιλιόμετρα|χλμ|χιλιομετρο"],
      ["in",  0.0254,     "in",  "Inch",       "Ίντσα",       "i", "inches|ίντσες|\""],
      ["ft",  0.3048,     "ft",  "Foot",       "Πόδι",        "i", "feet|foots|πόδια|'"],
      ["yd",  0.9144,     "yd",  "Yard",       "Γιάρδα",      "i", "yards|γιάρδες"],
      ["mi",  1609.344,   "mi",  "Mile",       "Μίλι",        "i", "miles|μίλια"],
      ["nmi", 1852,       "nmi", "Nautical mile", "Ναυτικό μίλι", "o", "nautical miles|ναυτικά μίλια|nm mile"],
      ["pichys", 0.75,    "πήχ.", "Builder's cubit (0.75 m)", "Τεκτονικός πήχης (0,75 m)", "o", "πήχης|πήχεις|πήχη|pichys|cubit"]
    ] },
    { id: "mass", base: "kg", en: "Weight", el: "Βάρος", def: ["kg", "lb"], u: [
      ["mg",  1e-6,          "mg",  "Milligram", "Χιλιοστόγραμμο", "m", "milligrams|milligramme|χιλιοστόγραμμα"],
      ["g",   0.001,         "g",   "Gram",      "Γραμμάριο",      "m", "grams|gramme|grammes|γραμμάρια|γρ|gr"],
      ["kg",  1,             "kg",  "Kilogram",  "Κιλό",           "m", "kilograms|kilo|kilos|kilogramme|κιλά|χιλιόγραμμο|χιλιόγραμμα"],
      ["t",   1000,          "t",   "Tonne",     "Τόνος",          "m", "tonnes|metric ton|metric tons|τόνοι|τόνους"],
      ["ct",  0.0002,        "ct",  "Carat",     "Καράτι",         "o", "carats|καράτια"],
      ["oz",  0.028349523125, "oz", "Ounce",     "Ουγγιά",         "i", "ounces|ουγγιές"],
      ["ozt", 0.0311034768,  "oz t", "Troy ounce", "Ουγγιά troy",  "o", "troy ounces|troy oz|ozt"],
      ["lb",  0.45359237,    "lb",  "Pound",     "Λίβρα",          "i", "pounds|lbs|λίβρες"],
      ["st",  6.35029318,    "st",  "Stone",     "Stone",          "i", "stones"],
      ["shton", 907.18474,   "US t", "Short ton (US)", "Κοντός τόνος (ΗΠΑ)", "i", "short ton|short tons|us ton|us tons"],
      ["lgton", 1016.0469088, "UK t", "Long ton (UK)", "Μακρύς τόνος (ΗΒ)", "i", "long ton|long tons|uk ton|uk tons"],
      ["oka", 1.2829,        "οκ.", "Oka (traditional)", "Οκά (παραδοσιακή)", "o", "οκά|οκάδες|οκα|oka|okes"],
      ["drami", 0.00320725,  "δρ.", "Drachm (1/400 oka)", "Δράμι (1/400 οκάς)", "o", "δράμι|δράμια|dram|drachm"]
    ] },
    { id: "volume", base: "L", en: "Volume", el: "Όγκος", def: ["L", "usgal"], u: [
      ["ml",   0.001,          "ml",  "Millilitre", "Χιλιοστόλιτρο", "m", "milliliter|milliliters|millilitres|mL|χιλιοστόλιτρα|μλ"],
      ["cl",   0.01,           "cl",  "Centilitre", "Εκατοστόλιτρο", "m", "centiliter|centiliters|εκατοστόλιτρα"],
      ["dl",   0.1,            "dl",  "Decilitre",  "Δεκατόλιτρο",   "m", "deciliter|deciliters|δεκατόλιτρα"],
      ["L",    1,              "L",   "Litre",      "Λίτρο",         "m", "l|liter|liters|litres|λίτρα|λτ"],
      ["cm3",  0.001,          "cm³", "Cubic centimetre", "Κυβικό εκατοστό", "m", "cm3|cc|cubic centimeter|cubic centimeters|κυβικά εκατοστά"],
      ["m3",   1000,           "m³",  "Cubic metre", "Κυβικό μέτρο", "m", "m3|cubic meter|cubic meters|cubic metres|κυβικά μέτρα|κυβικά"],
      ["in3",  0.016387064,    "in³", "Cubic inch", "Κυβική ίντσα",  "i", "in3|cubic inches|κυβικές ίντσες"],
      ["ft3",  28.316846592,   "ft³", "Cubic foot", "Κυβικό πόδι",   "i", "ft3|cubic feet|κυβικά πόδια"],
      ["usfloz", 0.0295735295625, "fl oz", "Fluid ounce (US)", "Υγρή ουγγιά (ΗΠΑ)", "i", "fl oz|floz|fluid ounce|fluid ounces|us fl oz"],
      ["ukfloz", 0.0284130625, "UK fl oz", "Fluid ounce (UK)", "Υγρή ουγγιά (ΗΒ)", "i", "uk fl oz|imperial fl oz"],
      ["uspt", 0.473176473,    "pt",  "Pint (US)",  "Πίντα (ΗΠΑ)",   "i", "pint|pints|us pint|us pints|πίντα|πίντες"],
      ["ukpt", 0.56826125,     "UK pt", "Pint (UK)", "Πίντα (ΗΒ)",   "i", "uk pint|uk pints|imperial pint"],
      ["usqt", 0.946352946,    "qt",  "Quart (US)", "Κουάρτ (ΗΠΑ)",  "i", "quart|quarts|us quart"],
      ["usgal", 3.785411784,   "gal", "Gallon (US)", "Γαλόνι (ΗΠΑ)", "i", "gallon|gallons|us gal|us gallon|us gallons|γαλόνι|γαλόνια"],
      ["ukgal", 4.54609,       "UK gal", "Gallon (UK)", "Γαλόνι (ΗΒ)", "i", "uk gallon|uk gallons|imperial gallon|imperial gallons"],
      ["bbl",  158.987294928,  "bbl", "Barrel (oil)", "Βαρέλι (πετρελαίου)", "o", "barrel|barrels|βαρέλι|βαρέλια"]
    ] },
    { id: "temp", base: "K", en: "Temperature", el: "Θερμοκρασία", def: ["C", "F"], neg: true, u: [
      ["C", "fn", "°C", "Celsius",    "Κελσίου",    "m", "c|celsius|centigrade|κελσίου|βαθμοί κελσίου|βαθμούς κελσίου"],
      ["F", "fn", "°F", "Fahrenheit", "Φαρενάιτ",   "i", "f|fahrenheit|φαρενάιτ"],
      ["K", "fn", "K",  "Kelvin",     "Κέλβιν",     "m", "k|kelvin|kelvins|κέλβιν"],
      ["R", "fn", "°R", "Rankine",    "Ράνκιν",     "o", "rankine"]
    ] },
    { id: "area", base: "m2", en: "Area", el: "Επιφάνεια", def: ["m2", "ft2"], u: [
      ["mm2", 1e-6,           "mm²", "Square millimetre", "Τετραγωνικό χιλιοστό", "m", "mm2|square millimeters|τετραγωνικά χιλιοστά"],
      ["cm2", 1e-4,           "cm²", "Square centimetre", "Τετραγωνικό εκατοστό", "m", "cm2|square centimeters|τετραγωνικά εκατοστά"],
      ["m2",  1,              "m²",  "Square metre",      "Τετραγωνικό μέτρο",    "m", "m2|sqm|square meter|square meters|square metres|τετραγωνικά|τετραγωνικά μέτρα|τμ|τ.μ."],
      ["ha",  10000,          "ha",  "Hectare",           "Εκτάριο",              "m", "hectares|εκτάρια"],
      ["km2", 1e6,            "km²", "Square kilometre",  "Τετραγωνικό χιλιόμετρο", "m", "km2|square kilometers|square kilometres|τετραγωνικά χιλιόμετρα"],
      ["in2", 0.00064516,     "in²", "Square inch",       "Τετραγωνική ίντσα",    "i", "in2|sq in|square inches"],
      ["ft2", 0.09290304,     "ft²", "Square foot",       "Τετραγωνικό πόδι",     "i", "ft2|sq ft|sqft|square feet"],
      ["yd2", 0.83612736,     "yd²", "Square yard",       "Τετραγωνική γιάρδα",   "i", "yd2|sq yd|square yards"],
      ["acre", 4046.8564224,  "ac",  "Acre",              "Άκρ",                  "i", "acres|ac"],
      ["mi2", 2589988.110336, "mi²", "Square mile",       "Τετραγωνικό μίλι",     "i", "mi2|sq mi|square miles"],
      ["strema", 1000,        "στρ.", "Stremma",          "Στρέμμα",              "o", "στρέμμα|στρέμματα|στρεμμα|stremma|stremmata|στρ"]
    ] },
    { id: "speed", base: "m/s", en: "Speed", el: "Ταχύτητα", def: ["kmh", "mph"], u: [
      ["mps", 1,               "m/s",  "Metre per second",    "Μέτρα ανά δευτερόλεπτο", "m", "m/s|meters per second|metres per second"],
      ["kmh", 1 / 3.6,         "km/h", "Kilometre per hour",  "Χιλιόμετρα ανά ώρα",     "m", "km/h|kmh|kph|kilometers per hour|χλμ/ώρα|χιλιόμετρα την ώρα"],
      ["mph", 0.44704,         "mph",  "Mile per hour",       "Μίλια ανά ώρα",          "i", "mi/h|miles per hour|μίλια την ώρα"],
      ["fts", 0.3048,          "ft/s", "Foot per second",     "Πόδια ανά δευτερόλεπτο", "i", "ft/s|fps|feet per second"],
      ["kn",  1852 / 3600,     "kn",   "Knot",                "Κόμβος",                 "o", "knot|knots|kt|κόμβοι|κόμβους"]
    ] },
    { id: "cooking", base: "L", en: "Cooking", el: "Μαγειρική", def: ["cup", "g"], dens: true, u: [
      ["tsp",   0.005,          "tsp",  "Teaspoon (5 ml)",    "Κουταλάκι γλυκού (5 ml)", "m", "teaspoon|teaspoons|κουταλάκι|κουταλάκια|κ.γ."],
      ["tbsp",  0.015,          "tbsp", "Tablespoon (15 ml)", "Κουταλιά σούπας (15 ml)", "m", "tablespoon|tablespoons|κουταλιά|κουταλιές|κ.σ."],
      ["cup",   0.25,           "cup",  "Cup (250 ml)",       "Φλιτζάνι (250 ml)",       "m", "cups|metric cup|φλιτζάνι|φλιτζάνια|κούπα|κούπες"],
      ["ustsp", 0.00492892159375, "US tsp", "Teaspoon (US)",  "Κουταλάκι (ΗΠΑ)",         "i", "us tsp|us teaspoon"],
      ["ustbsp", 0.01478676478125, "US tbsp", "Tablespoon (US)", "Κουταλιά (ΗΠΑ)",     "i", "us tbsp|us tablespoon"],
      ["uscup", 0.2365882365,   "US cup", "Cup (US)",         "Φλιτζάνι (ΗΠΑ)",          "i", "us cup|us cups"],
      ["cfloz", 0.0295735295625, "fl oz", "Fluid ounce (US)", "Υγρή ουγγιά (ΗΠΑ)",       "i", "fl oz|floz|fluid ounce|fluid ounces"],
      ["cml",   0.001,          "ml",   "Millilitre",         "Χιλιοστόλιτρο",           "m", "ml|milliliter|milliliters|χιλιοστόλιτρα"],
      ["cliter", 1,              "L",    "Litre",              "Λίτρο",                   "m", "l|liter|liters|λίτρα"],
      ["g",     "w0.001",       "g",    "Gram",               "Γραμμάριο",               "m", "grams|γραμμάρια|γρ|gr"],
      ["ckg",   "w1",           "kg",   "Kilogram",           "Κιλό",                    "m", "kg|kilo|kilos|κιλά"],
      ["coz",   "w0.028349523125", "oz", "Ounce",             "Ουγγιά",                  "i", "oz|ounces|ουγγιές"],
      ["clb",   "w0.45359237",  "lb",   "Pound",              "Λίβρα",                   "i", "lb|pounds|λίβρες"]
    ] },
    { id: "time", base: "s", en: "Time", el: "Χρόνος", def: ["h", "min"], u: [
      ["ms",   0.001,     "ms",  "Millisecond", "Χιλιοστό του δευτερολέπτου", "m", "milliseconds|msec"],
      ["s",    1,         "s",   "Second",      "Δευτερόλεπτο", "m", "sec|secs|seconds|δευτερόλεπτα|δευτ"],
      ["min",  60,        "min", "Minute",      "Λεπτό",        "m", "minutes|mins|λεπτά"],
      ["h",    3600,      "h",   "Hour",        "Ώρα",          "m", "hr|hrs|hours|ώρες|ωρες"],
      ["d",    86400,     "d",   "Day",         "Μέρα",         "m", "day|days|μέρες|ημέρα|ημέρες"],
      ["wk",   604800,    "wk",  "Week",        "Εβδομάδα",     "m", "week|weeks|εβδομάδες"],
      ["mo",   2629746,   "mo",  "Month (average)", "Μήνας (μέσος)", "o", "month|months|μήνας|μήνες"],
      ["yr",   31556952,  "yr",  "Year (average)",  "Έτος (μέσο)",   "o", "year|years|y|έτος|έτη|χρόνος|χρόνια"]
    ] },
    { id: "data", base: "B", en: "Data", el: "Δεδομένα", def: ["GB", "MB"], u: [
      ["bit",  0.125,          "bit", "Bit",       "Bit",       "m", "bits"],
      ["B",    1,              "B",   "Byte",      "Byte",      "m", "bytes"],
      ["kB",   1e3,            "kB",  "Kilobyte",  "Kilobyte",  "m", "kb|kilobytes"],
      ["MB",   1e6,            "MB",  "Megabyte",  "Megabyte",  "m", "mb|megabytes"],
      ["GB",   1e9,            "GB",  "Gigabyte",  "Gigabyte",  "m", "gb|gigabytes|giga"],
      ["TB",   1e12,           "TB",  "Terabyte",  "Terabyte",  "m", "tb|terabytes"],
      ["PB",   1e15,           "PB",  "Petabyte",  "Petabyte",  "m", "pb|petabytes"],
      ["Mbit", 125000,         "Mbit", "Megabit",  "Megabit",   "m", "mbit|mbits|megabits|mb/s"],
      ["Gbit", 125000000,      "Gbit", "Gigabit",  "Gigabit",   "m", "gbit|gbits|gigabits"],
      ["KiB",  1024,           "KiB", "Kibibyte",  "Kibibyte",  "o", "kib|kibibytes"],
      ["MiB",  1048576,        "MiB", "Mebibyte",  "Mebibyte",  "o", "mib|mebibytes"],
      ["GiB",  1073741824,     "GiB", "Gibibyte",  "Gibibyte",  "o", "gib|gibibytes"],
      ["TiB",  1099511627776,  "TiB", "Tebibyte",  "Tebibyte",  "o", "tib|tebibytes"]
    ] },
    { id: "fuel", base: "L/100km", en: "Fuel economy", el: "Κατανάλωση καυσίμου", def: ["l100", "mpgus"], u: [
      ["l100",  "fn", "L/100 km", "Litres per 100 km", "Λίτρα ανά 100 km", "m", "l/100km|l/100 km|l100km|λίτρα τα 100"],
      ["kml",   "fn", "km/L",     "Kilometres per litre", "Χιλιόμετρα με ένα λίτρο", "m", "km/l|kmpl|χλμ/λίτρο"],
      ["mpgus", "fn", "mpg",      "Miles per gallon (US)", "Μίλια ανά γαλόνι (ΗΠΑ)", "i", "mpg|us mpg|mpg us"],
      ["mpguk", "fn", "UK mpg",   "Miles per gallon (UK)", "Μίλια ανά γαλόνι (ΗΒ)",  "i", "uk mpg|mpg uk|imperial mpg"]
    ] },
    { id: "pressure", base: "Pa", en: "Pressure", el: "Πίεση", def: ["bar", "psi"], u: [
      ["Pa",   1,                 "Pa",   "Pascal",      "Πασκάλ",          "m", "pa|pascal|pascals"],
      ["hPa",  100,               "hPa",  "Hectopascal", "Εκτοπασκάλ",      "m", "hpa|hectopascals"],
      ["kPa",  1000,              "kPa",  "Kilopascal",  "Κιλοπασκάλ",      "m", "kpa|kilopascals"],
      ["MPa",  1e6,               "MPa",  "Megapascal",  "Μεγαπασκάλ",      "m", "mpa|megapascals"],
      ["mbar", 100,               "mbar", "Millibar",    "Μιλιμπάρ",        "m", "millibar|millibars"],
      ["bar",  1e5,               "bar",  "Bar",         "Μπαρ",            "m", "bars|μπαρ"],
      ["atm",  101325,            "atm",  "Atmosphere",  "Ατμόσφαιρα",      "o", "atmospheres|ατμόσφαιρες"],
      ["psi",  6894.757293168361, "psi",  "Pound per square inch", "Λίβρες ανά τετρ. ίντσα", "i", "lbf/in2|pounds per square inch"],
      ["mmHg", 133.322387415,     "mmHg", "Millimetre of mercury", "Χιλιοστά υδραργύρου", "o", "mmhg|torr|χιλιοστά στήλης υδραργύρου"],
      ["inHg", 3386.388640341,    "inHg", "Inch of mercury", "Ίντσες υδραργύρου", "i", "inhg|inches of mercury"]
    ] },
    { id: "energy", base: "J", en: "Energy", el: "Ενέργεια", def: ["kcal", "kJ"], u: [
      ["J",    1,                "J",    "Joule",          "Τζάουλ",        "m", "j|joules"],
      ["kJ",   1000,             "kJ",   "Kilojoule",      "Κιλοτζάουλ",    "m", "kj|kilojoules"],
      ["MJ",   1e6,              "MJ",   "Megajoule",      "Μεγατζάουλ",    "m", "mj|megajoules"],
      ["cal",  4.184,            "cal",  "Calorie",        "Θερμίδα",       "o", "calorie|calories|θερμίδες"],
      ["kcal", 4184,             "kcal", "Kilocalorie",    "Κιλοθερμίδα",   "o", "kilocalorie|kilocalories|κιλοθερμίδες"],
      ["Wh",   3600,             "Wh",   "Watt-hour",      "Βατώρα",        "m", "wh|watt hour|watt hours|βατώρες"],
      ["kWh",  3.6e6,            "kWh",  "Kilowatt-hour",  "Κιλοβατώρα",    "m", "kwh|kilowatt hour|kilowatt hours|κιλοβατώρες"],
      ["BTU",  1055.05585262,    "BTU",  "British thermal unit", "BTU",     "i", "btu|btus"]
    ] },
    { id: "power", base: "W", en: "Power", el: "Ισχύς", def: ["kW", "hp"], u: [
      ["W",    1,                     "W",     "Watt",               "Βατ",               "m", "w|watts|βατ"],
      ["kW",   1000,                  "kW",    "Kilowatt",           "Κιλοβάτ",           "m", "kw|kilowatts|κιλοβάτ"],
      ["MW",   1e6,                   "MW",    "Megawatt",           "Μεγαβάτ",           "m", "mw|megawatts"],
      ["PS",   735.49875,             "PS",    "Metric horsepower",  "Ίππος (μετρικός)",  "o", "ps|cv|metric hp|ίπποι|ίππους|άλογα"],
      ["hp",   745.69987158227022,    "hp",    "Horsepower (mechanical)", "Ίππος (μηχανικός)", "i", "bhp|horsepower"],
      ["btuh", 0.29307107017222,      "BTU/h", "BTU per hour",       "BTU ανά ώρα",       "i", "btu/h|btuh|btu per hour"]
    ] },
    { id: "angle", base: "deg", en: "Angle", el: "Γωνία", def: ["deg", "rad"], neg: true, u: [
      ["deg",    1,                  "°",    "Degree",      "Μοίρα",           "m", "deg|degrees|μοίρες"],
      ["rad",    180 / Math.PI,      "rad",  "Radian",      "Ακτίνιο",         "m", "radian|radians|ακτίνια"],
      ["grad",   0.9,                "gon",  "Gradian",     "Βαθμός (grad)",   "o", "grad|grads|gradians|gon"],
      ["arcmin", 1 / 60,             "′",    "Arcminute",   "Πρώτο λεπτό",     "o", "arcmin|arcminutes|πρώτα λεπτά"],
      ["arcsec", 1 / 3600,           "″",    "Arcsecond",   "Δεύτερο λεπτό",   "o", "arcsec|arcseconds"],
      ["turn",   360,                "turn", "Full turn",   "Πλήρης στροφή",   "o", "turns|rev|revolution|revolutions|στροφές|στροφή"]
    ] },
    { id: "currency", base: "EUR", en: "Currency", el: "Νομίσματα", def: ["EUR", "USD"], money: true, u: [] }
  ];

  // Ingredients for Cooking (volume ⇄ weight), grams per millilitre.
  // Approximate kitchen values; the app says so.
  var INGREDIENTS = [
    ["water",  1.0,   "Water",            "Νερό"],
    ["milk",   1.03,  "Milk",             "Γάλα"],
    ["oil",    0.92,  "Oil",              "Λάδι"],
    ["butter", 0.96,  "Butter",           "Βούτυρο"],
    ["flour",  0.53,  "Flour",            "Αλεύρι"],
    ["sugar",  0.85,  "Sugar",            "Ζάχαρη"],
    ["icing",  0.5,   "Icing sugar",      "Ζάχαρη άχνη"],
    ["rice",   0.85,  "Rice (uncooked)",  "Ρύζι (άβραστο)"],
    ["honey",  1.42,  "Honey",            "Μέλι"],
    ["salt",   1.2,   "Salt",             "Αλάτι"],
    ["cocoa",  0.42,  "Cocoa powder",     "Κακάο"]
  ];

  // ECB reference currencies (frankfurter.dev); EUR is the base.
  var CURRENCY_ORDER = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK",
                        "HUF", "RON", "BGN", "TRY", "CNY", "HKD", "SGD", "KRW", "INR", "BRL", "MXN", "ZAR",
                        "ILS", "NZD", "THB", "PHP", "MYR", "IDR", "ISK"];

  var CURRENCY_ALIASES = {
    EUR: "€|euro|euros|ευρώ",
    USD: "$|us$|dollar|dollars|δολάριο|δολάρια",
    GBP: "£|pound sterling|sterling|στερλίνα|στερλίνες|λίρα αγγλίας",
    JPY: "¥|yen|γιεν",
    CHF: "swiss franc|swiss francs|ελβετικό φράγκο|ελβετικά φράγκα"
  };

  // Unit objects, built once: { id, cat, f | fn, sym, en, el, g, al[] }
  var CAT_BY_ID = {};
  CATS.forEach(function (c) {
    CAT_BY_ID[c.id] = c;
    c.units = c.u.map(function (r) {
      var u = { id: r[0], cat: c.id, sym: r[2], en: r[3], el: r[4], g: r[5],
                al: (r[6] ? r[6].split("|") : []) };
      if (typeof r[1] === "number") u.f = r[1];
      else if (typeof r[1] === "string" && r[1].charAt(0) === "w") { u.w = parseFloat(r[1].slice(1)); }   // weight in kg (cooking)
      else u.fn = true;
      return u;
    });
  });

  function cat(id) { return own(CAT_BY_ID, id) ? CAT_BY_ID[id] : null; }

  // Currency units from the rates (EUR always; others only with a rate).
  function currencyUnits(rates) {
    var r = rates && rates.rates ? rates.rates : {};
    var codes = ["EUR"];
    Object.keys(r).forEach(function (k) { if (k !== "EUR") codes.push(k); });
    codes.sort(function (a, b) {
      var ia = CURRENCY_ORDER.indexOf(a), ib = CURRENCY_ORDER.indexOf(b);
      if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      return ia - ib || cmpStr(a, b);
    });
    return codes.map(function (k) {
      return { id: k, cat: "currency", sym: k, en: k, el: k, g: "m", al: own(CURRENCY_ALIASES, k) ? CURRENCY_ALIASES[k].split("|") : [],
               rate: k === "EUR" ? 1 : r[k] };
    });
  }

  function unitsOf(catId, rates) {
    if (catId === "currency") return currencyUnits(rates);
    var c = cat(catId);
    return c ? c.units : [];
  }
  function unit(catId, id, rates) {
    var list = unitsOf(catId, rates);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ---------- Conversion ----------
  var FUEL_US = 100 * 3.785411784 / 1.609344;   // 235.2145833...
  var FUEL_UK = 100 * 4.54609 / 1.609344;       // 282.4809363...

  function tempToK(id, v) {
    if (id === "C") return v + 273.15;
    if (id === "F") return (v - 32) * 5 / 9 + 273.15;
    if (id === "K") return v;
    if (id === "R") return v * 5 / 9;
    return NaN;
  }
  function tempFromK(id, k) {
    if (id === "C") return k - 273.15;
    if (id === "F") return (k - 273.15) * 9 / 5 + 32;
    if (id === "K") return k;
    if (id === "R") return k * 9 / 5;
    return NaN;
  }
  // Fuel: every unit through L/100 km; both directions are 1/x
  // except L/100 km itself. 0 has no counterpart (Infinity → NaN).
  function fuelTo(id, v) {
    if (id === "l100") return v;
    if (v === 0) return NaN;
    if (id === "kml") return 100 / v;
    if (id === "mpgus") return FUEL_US / v;
    if (id === "mpguk") return FUEL_UK / v;
    return NaN;
  }
  function fuelFrom(id, l) { return id === "l100" ? l : fuelTo(id, l); }   // the same reciprocal

  // Converts v from unit `from` to unit `to` in category catId.
  // opts: { rates, dens (g/ml, Cooking) }. Returns
  //   { ok: true, v } or { ok: false, err: "unit"|"zero"|"belowZero"|"neg"|"rate"|"dens" }
  function convert(catId, from, to, v, opts) {
    opts = opts || {};
    var c = cat(catId);
    if (!c || !isNum(v)) return { ok: false, err: "unit" };
    var a = unit(catId, from, opts.rates), b = unit(catId, to, opts.rates);
    if (!a || !b) return { ok: false, err: c.money ? "rate" : "unit" };
    if (v < 0 && !c.neg) return { ok: false, err: "neg" };
    var out;
    if (catId === "temp") {
      var k = tempToK(a.id, v);
      if (k < 0) return { ok: false, err: "belowZero" };
      out = tempFromK(b.id, k);
    } else if (catId === "fuel") {
      out = fuelFrom(b.id, fuelTo(a.id, v));
      if (!isNum(out)) return { ok: false, err: "zero" };
    } else if (catId === "currency") {
      if (!isNum(a.rate) || !isNum(b.rate) || a.rate <= 0 || b.rate <= 0) return { ok: false, err: "rate" };
      out = v / a.rate * b.rate;
    } else if (c.dens) {
      // Cooking: volume units in litres (f), weights in kg (w).
      var aw = a.w !== undefined, bw = b.w !== undefined;
      if (aw === bw) out = aw ? v * a.w / b.w : v * a.f / b.f;
      else {
        var d = opts.dens;
        if (!isNum(d) || d <= 0) return { ok: false, err: "dens" };
        // litres → kg: L × 1000 ml × d g/ml / 1000 = L × d
        out = aw ? v * a.w / d / b.f : v * a.f * d / b.w;
      }
    } else {
      out = v * a.f / b.f;
    }
    if (!isNum(out)) return { ok: false, err: "zero" };
    if (Math.abs(out) < 1e-300) out = 0;
    return { ok: true, v: out };
  }

  // True when Cooking needs an ingredient for this pair.
  function needsDensity(catId, from, to) {
    var c = cat(catId);
    if (!c || !c.dens) return false;
    var a = unit(catId, from), b = unit(catId, to);
    return !!(a && b && (a.w !== undefined) !== (b.w !== undefined));
  }
  function ingredient(id) {
    for (var i = 0; i < INGREDIENTS.length; i++) if (INGREDIENTS[i][0] === id) return INGREDIENTS[i];
    return null;
  }

  // ---------- Numbers in ----------
  // Accepts "1,5" or "1.5"; both separators: the last one is the
  // decimal point ("1.234,5", "1,234.5"). A single separator with
  // exactly three digits after it is the language's thousands mark
  // (el "1.500" = 1500, en "1,500" = 1500); otherwise a decimal
  // point. Spaces (also thin / no-break) are ignored.
  // Then + − × ÷ * / ( ) and unary minus; no eval.
  // Returns { ok: true, v } or { ok: false } (empty → { ok: false, empty: true }).
  function normNumber(tok, lang) {
    var hasDot = tok.indexOf(".") >= 0, hasCom = tok.indexOf(",") >= 0;
    if (hasDot && hasCom) {
      var last = Math.max(tok.lastIndexOf("."), tok.lastIndexOf(","));
      var dec = tok.charAt(last), th = dec === "." ? "," : ".";
      if (tok.indexOf(dec) !== last) return null;
      return tok.split(th).join("").replace(dec, ".");
    }
    var sep = hasDot ? "." : (hasCom ? "," : "");
    if (!sep) return tok;
    var parts = tok.split(sep);
    var groupSep = lang === "el" ? "." : ",";
    if (parts.length > 2) {                               // 1.000.000
      for (var i = 1; i < parts.length; i++) if (parts[i].length !== 3) return null;
      return parts.join("");
    }
    if (sep === groupSep && parts[1].length === 3 && parts[0].length > 0 && parts[0] !== "0") return parts.join("");
    return parts[0] + "." + parts[1];
  }

  function parseInput(s, lang) {
    if (typeof s !== "string") return { ok: false, empty: true };
    s = s.replace(/[\s   ]+/g, "")
         .replace(/[×xX·]/g, "*").replace(/[÷:]/g, "/").replace(/[−–—]/g, "-");
    if (!s) return { ok: false, empty: true };
    if (s.length > 200) return { ok: false };
    var toks = [], m, re = /(\d[\d.,]*|[.,]\d+)|([+\-*/()])|(e[+\-]?\d+)/gi, pos = 0;
    while ((m = re.exec(s))) {
      if (m.index !== pos) return { ok: false };
      pos = re.lastIndex;
      if (m[1]) {
        var n = normNumber(m[1], lang);
        if (n === null || !/^(\d+\.?\d*|\.\d+)$/.test(n)) return { ok: false };
        toks.push({ n: parseFloat(n) });
      } else if (m[2]) toks.push({ o: m[2] });
      else {                                              // 1,5e3 (exponent after a number)
        var prev = toks[toks.length - 1];
        if (!prev || prev.n === undefined) return { ok: false };
        prev.n = prev.n * Math.pow(10, parseInt(m[3].slice(1), 10));
      }
    }
    if (pos !== s.length || !toks.length) return { ok: false };
    var i = 0;
    function peek() { return toks[i]; }
    function expr() {
      var v = term();
      while (peek() && (peek().o === "+" || peek().o === "-")) {
        var op = toks[i++].o, r = term();
        v = op === "+" ? v + r : v - r;
      }
      return v;
    }
    function term() {
      var v = unary();
      while (peek() && (peek().o === "*" || peek().o === "/")) {
        var op = toks[i++].o, r = unary();
        v = op === "*" ? v * r : v / r;
      }
      return v;
    }
    function unary() {
      if (peek() && peek().o === "-") { i++; return -unary(); }
      if (peek() && peek().o === "+") { i++; return unary(); }
      return atom();
    }
    function atom() {
      var tk = toks[i++];
      if (!tk) throw 0;
      if (tk.n !== undefined) return tk.n;
      if (tk.o === "(") {
        var v = expr();
        if (!peek() || peek().o !== ")") throw 0;
        i++;
        return v;
      }
      throw 0;
    }
    var v;
    try { v = expr(); } catch (e) { return { ok: false }; }
    if (i !== toks.length || !isNum(v)) return { ok: false };
    return { ok: true, v: v };
  }

  // ---------- Numbers out ----------
  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
  function clampPrec(p) { return isInt(p) && p >= PREC_MIN && p <= PREC_MAX ? p : PREC_DEF; }

  // Rounds to `prec` significant digits and writes the number in
  // the language's format. group: thousands marks (display only;
  // the input fields get none, so they read back unchanged).
  // sci: "1,23 × 10⁹" for very large or small numbers.
  function formatNumber(v, prec, lang, group) {
    if (!isNum(v)) return "";
    prec = clampPrec(prec);
    var loc = lang === "el" ? "el-GR" : "en-GB";
    var dec = lang === "el" ? "," : ".";
    if (v === 0) return "0";
    var r = Number(v.toPrecision(prec));
    var a = Math.abs(r);
    if (a >= 1e15 || a < 1e-6) {
      var parts = r.toExponential(prec - 1).split("e");
      var mant = parts[0].replace(/\.?0+$/, "").replace(".", dec);
      var ex = String(parseInt(parts[1], 10)).split("").map(function (ch) { return SUP[ch] || ch; }).join("");
      return mant + " × 10" + ex;
    }
    try {
      return new Intl.NumberFormat(loc, { maximumSignificantDigits: prec, useGrouping: !!group }).format(r);
    } catch (e) {
      return String(r).replace(".", dec);
    }
  }

  // ---------- Names + aliases ----------
  function fold(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function unitName(u, lang) {
    if (u.cat === "currency") return currencyName(u.id, lang);
    return lang === "el" ? u.el : u.en;
  }
  var DN = {};
  function currencyName(code, lang) {
    var loc = lang === "el" ? "el" : "en";
    try {
      if (!DN[loc] && typeof Intl !== "undefined" && Intl.DisplayNames) DN[loc] = new Intl.DisplayNames([loc], { type: "currency" });
      var n = DN[loc] ? DN[loc].of(code) : "";
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) {}
    return code;
  }
  function catName(c, lang) { return lang === "el" ? c.el : c.en; }

  // Every way a unit can be written, folded. Names in both languages.
  function aliasesOf(u) {
    var list = [u.id, u.sym, u.en, u.el].concat(u.al);
    if (u.en.indexOf("(") < 0) list.push(u.en + "s");
    if (u.cat === "currency") list.push(currencyName(u.id, "en"), currencyName(u.id, "el"));
    var seen = {}, out = [];
    list.forEach(function (a) {
      var f = fold(a);
      if (f && !seen[f]) { seen[f] = true; out.push(f); }
    });
    return out;
  }

  // Units matching a text (the unit picker's search): prefix of a
  // word in a name or alias, in either language.
  function matchUnits(units, q) {
    var f = fold(q);
    if (!f) return units.slice();
    return units.filter(function (u) {
      var al = aliasesOf(u);
      for (var i = 0; i < al.length; i++) {
        if (al[i].indexOf(f) === 0 || al[i].indexOf(" " + f) >= 0 || al[i].indexOf("(" + f) >= 0) return true;
      }
      return false;
    });
  }

  // ---------- Query parser ("10 km σε mi") ----------
  // An index of every alias → [{ cat, id }], longest aliases first.
  function aliasIndex(rates) {
    var idx = {}, keys = [];
    CATS.forEach(function (c) {
      unitsOf(c.id, rates).forEach(function (u) {
        aliasesOf(u).forEach(function (a) {
          if (!own(idx, a)) { idx[a] = []; keys.push(a); }
          idx[a].push({ cat: c.id, id: u.id });
        });
      });
    });
    keys.sort(function (a, b) { return b.length - a.length || cmpStr(a, b); });
    return { idx: idx, keys: keys };
  }

  var JOIN_WORDS = ["σε", "se", "to", "in", "into", "as", "->", "→", "=", "εισ", "προσ"];

  // The longest alias at the start of text (whole words only).
  function takeUnit(ai, text) {
    for (var i = 0; i < ai.keys.length; i++) {
      var k = ai.keys[i];
      if (text.indexOf(k) !== 0) continue;
      var next = text.charAt(k.length);
      if (next && /[a-z0-9α-ω]/.test(next) && /[a-z0-9α-ω]$/.test(k)) continue;
      return { refs: ai.idx[k], rest: text.slice(k.length).trim() };
    }
    return null;
  }

  // q → { v, cat, from, to | null } or null. Only "<number> <unit>
  // [to|σε|in|=|→ <unit>]"; the number may use the comma.
  function parseQuery(q, lang, rates) {
    var f = fold(q);
    var m = /^(-?\d[\d.,]*|-?[.,]\d+)\s*(.*)$/.exec(f);
    if (!m) return null;
    var n = parseInput(m[1], lang);
    if (!n.ok || !m[2]) return null;
    var ai = aliasIndex(rates);
    var a = takeUnit(ai, m[2]);
    if (!a) return null;
    var rest = a.rest, b = null;
    if (rest) {
      var w = rest.split(" ")[0];
      if (JOIN_WORDS.indexOf(w) >= 0) rest = rest.slice(w.length).trim();
      else if (/^(->|→|=)/.test(rest)) rest = rest.replace(/^(->|→|=)\s*/, "");
      b = takeUnit(ai, rest);
      if (!b || b.rest) return null;
    }
    // Pick the category both units share (oz: mass or cooking).
    var pref = ["length", "mass", "volume", "temp", "area", "speed", "time", "data", "fuel", "pressure", "energy", "power", "angle", "currency", "cooking"];
    for (var p = 0; p < pref.length; p++) {
      var ra = null, rb = null, i;
      for (i = 0; i < a.refs.length; i++) if (a.refs[i].cat === pref[p]) { ra = a.refs[i]; break; }
      if (!ra) continue;
      if (b) {
        for (i = 0; i < b.refs.length; i++) if (b.refs[i].cat === pref[p]) { rb = b.refs[i]; break; }
        if (!rb || rb.id === ra.id) continue;
      }
      return { v: n.v, cat: pref[p], from: ra.id, to: rb ? rb.id : null };
    }
    return null;
  }

  // The other unit to show when a query names only one: the
  // category's default pair, or the partner from that pair.
  function partnerOf(catId, from) {
    var c = cat(catId);
    if (!c) return null;
    if (from === c.def[0]) return c.def[1];
    if (from === c.def[1]) return c.def[0];
    return c.def[0];
  }

  // ---------- Synced data ----------
  function favId(c, f, t) { return c + ":" + f + ">" + t; }
  // i: the ingredient of a Cooking cups ⇄ grams conversion, else none.
  function recId(c, f, t, v, i) { return favId(c, f, t) + "=" + String(v) + (i ? "@" + i : ""); }
  var ID_RE = /^[a-z]+:[A-Za-z0-9]{1,8}>[A-Za-z0-9]{1,8}(=-?[0-9.e+\-]+(@[a-z]{1,8})?)?$/;

  function normPair(raw) {
    if (!raw || typeof raw !== "object") return null;
    var c = typeof raw.c === "string" ? cat(raw.c) : null;
    if (!c || !isInt(raw.m) || raw.m < 0) return null;
    var okU = function (id) {
      return typeof id === "string" && (c.money ? /^[A-Z]{3}$/.test(id) : !!unit(c.id, id));
    };
    if (!okU(raw.f) || !okU(raw.t) || raw.f === raw.t) return null;
    return { c: c.id, f: raw.f, t: raw.t, m: raw.m };
  }
  function better(x, y) {   // x newer than y (ties: larger JSON), deterministic
    return !y || x.m > y.m || (x.m === y.m && JSON.stringify(x) > JSON.stringify(y));
  }

  function mergeData(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (k) {
        if (!ID_RE.test(k) || !isInt(tm[k]) || tm[k] < 0) return;
        if (!own(tombs, k) || tm[k] > tombs[k]) tombs[k] = tm[k];
      });
    });
    var favs = {}, recent = {};
    [a.favs, b.favs].forEach(function (src) {
      if (!src || typeof src !== "object" || Array.isArray(src)) return;
      Object.keys(src).forEach(function (k) {
        var p = normPair(src[k]);
        if (!p || k !== favId(p.c, p.f, p.t)) return;
        if (better(p, favs[k])) favs[k] = p;
      });
    });
    [a.recent, b.recent].forEach(function (src) {
      if (!src || typeof src !== "object" || Array.isArray(src)) return;
      Object.keys(src).forEach(function (k) {
        var p = normPair(src[k]), v = src[k] && src[k].v;
        var i = src[k] && src[k].i;
        if (!p || !isNum(v)) return;
        if (needsDensity(p.c, p.f, p.t)) { if (typeof i !== "string" || !ingredient(i)) return; }
        else if (i !== undefined) return;
        if (k !== recId(p.c, p.f, p.t, v, i)) return;
        p.v = v;
        if (i) p.i = i;
        if (better(p, recent[k])) recent[k] = p;
      });
    });
    var outF = {}, outR = {};
    Object.keys(favs).sort(cmpStr).forEach(function (k) {
      if (own(tombs, k) && tombs[k] >= favs[k].m) return;
      outF[k] = favs[k];
    });
    var rk = Object.keys(recent).filter(function (k) { return !(own(tombs, k) && tombs[k] >= recent[k].m); });
    rk.sort(function (x, y) { return recent[y].m - recent[x].m || cmpStr(x, y); });
    rk.slice(0, RECENT_MAX).sort(cmpStr).forEach(function (k) { outR[k] = recent[k]; });
    var tk = Object.keys(tombs);
    tk.sort(function (x, y) { return tombs[y] - tombs[x] || cmpStr(x, y); });
    var outT = {};
    tk.slice(0, TOMBS_MAX).sort(cmpStr).forEach(function (k) { outT[k] = tombs[k]; });
    var prec = null;
    [a.prec, b.prec].forEach(function (p) {
      if (!p || typeof p !== "object" || !isInt(p.m) || p.m < 0 || clampPrec(p.v) !== p.v) return;
      var q = { v: p.v, m: p.m };
      if (better(q, prec)) prec = q;
    });
    return { ver: DATA_VER, favs: outF, recent: outR, prec: prec, tombs: outT };
  }

  function emptyData() { return { ver: DATA_VER, favs: {}, recent: {}, prec: null, tombs: {} }; }

  function stamp(cur, id, now) {
    var old = (cur.favs[id] || cur.recent[id] || {}).m || 0;
    return Math.max(now, (cur.tombs[id] || 0) + 1, old + 1);
  }

  // Star / unstar a pair. Returns the new data (input untouched).
  function toggleFav(data, c, f, t, now) {
    var cur = mergeData(data, null), id = favId(c, f, t), patch = emptyData();
    if (cur.favs[id]) patch.tombs[id] = stamp(cur, id, now);
    else patch.favs[id] = { c: c, f: f, t: t, m: stamp(cur, id, now) };
    return mergeData(cur, patch);
  }
  function isFav(data, c, f, t) { return !!(data && data.favs && data.favs[favId(c, f, t)]); }

  // A conversion used (typed, then left alone): newest first.
  function addRecent(data, c, f, t, v, now, ing) {
    var cur = mergeData(data, null);
    if (!isNum(v)) return cur;
    var i = needsDensity(c, f, t) ? (ingredient(ing) ? ing : "water") : undefined;
    var id = recId(c, f, t, v, i), patch = emptyData();
    patch.recent[id] = { c: c, f: f, t: t, v: v, m: stamp(cur, id, now) };
    if (i) patch.recent[id].i = i;
    return mergeData(cur, patch);
  }
  function clearRecent(data, now) {
    var cur = mergeData(data, null), patch = emptyData();
    Object.keys(cur.recent).forEach(function (id) { patch.tombs[id] = stamp(cur, id, now); });
    return mergeData(cur, patch);
  }
  function setPrec(data, p, now) {
    var cur = mergeData(data, null);
    p = clampPrec(p);
    if ((cur.prec ? cur.prec.v : PREC_DEF) === p && cur.prec) return cur;
    var patch = emptyData();
    patch.prec = { v: p, m: Math.max(now, cur.prec ? cur.prec.m + 1 : 0) };
    return mergeData(cur, patch);
  }
  function precOf(data) { return data && data.prec ? clampPrec(data.prec.v) : PREC_DEF; }

  // Favourites, oldest star first; recents newest first.
  function favList(data) {
    var f = (data && data.favs) || {};
    return Object.keys(f).map(function (k) { return f[k]; })
      .sort(function (x, y) { return x.m - y.m || cmpStr(favId(x.c, x.f, x.t), favId(y.c, y.f, y.t)); });
  }
  function recentList(data) {
    var r = (data && data.recent) || {};
    return Object.keys(r).map(function (k) { return r[k]; })
      .sort(function (x, y) { return y.m - x.m || cmpStr(recId(x.c, x.f, x.t, x.v, x.i), recId(y.c, y.f, y.t, y.v, y.i)); });
  }

  // ---------- Device-local prefs ----------
  // { cat, pairs: { cat: { f, t } }, ing: ingredient id, all: the
  // "All units" list open (default) }
  function readPrefs(raw) {
    var p = { cat: "length", pairs: {}, ing: "water", all: true };
    if (!raw || typeof raw !== "object") return p;
    if (typeof raw.cat === "string" && cat(raw.cat)) p.cat = raw.cat;
    if (raw.pairs && typeof raw.pairs === "object") {
      Object.keys(raw.pairs).forEach(function (k) {
        var c = cat(k), pr = raw.pairs[k];
        if (!c || !pr || typeof pr.f !== "string" || typeof pr.t !== "string") return;
        var ok = c.money ? /^[A-Z]{3}$/.test(pr.f) && /^[A-Z]{3}$/.test(pr.t) : unit(k, pr.f) && unit(k, pr.t);
        if (ok) p.pairs[k] = { f: pr.f, t: pr.t };
      });
    }
    if (typeof raw.ing === "string" && ingredient(raw.ing)) p.ing = raw.ing;
    p.all = raw.all !== false;
    return p;
  }
  function pairOf(prefs, catId) {
    var c = cat(catId);
    var p = prefs && prefs.pairs && prefs.pairs[catId];
    return p ? { f: p.f, t: p.t } : { f: c.def[0], t: c.def[1] };
  }

  // ---------- Currency rates ----------
  // A Frankfurter reply → the stored rates, or null when it is not
  // one. Only 3-letter codes with a finite positive rate, at most 60.
  function readRates(json, now, src) {
    if (!json || typeof json !== "object" || json.base !== "EUR" || !json.rates || typeof json.rates !== "object") return null;
    if (typeof json.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(json.date)) return null;
    var rates = {}, n = 0;
    Object.keys(json.rates).sort(cmpStr).forEach(function (k) {
      var v = json.rates[k];
      if (n >= 60 || !/^[A-Z]{3}$/.test(k) || k === "EUR" || !isNum(v) || v <= 0) return;
      rates[k] = v; n++;
    });
    if (!n) return null;
    return { base: "EUR", date: json.date, at: isInt(now) ? now : 0, src: typeof src === "string" ? src : "", rates: rates };
  }
  // Stored rates read back (device-local key), or null.
  function storedRates(raw) {
    if (!raw || typeof raw !== "object" || !isInt(raw.at)) return null;
    var r = readRates({ base: raw.base, date: raw.date, rates: raw.rates }, raw.at, raw.src);
    return r;
  }
  // Fetch again when there are none or they are older than 6 hours.
  function ratesStale(rates, now) { return !rates || !isInt(rates.at) || now - rates.at > 6 * 3600000 || rates.at > now; }

  // ---------- Formula line ----------
  // "1 mi = 1.609344 km" for linear units; temperature and fuel
  // show their rule instead (the app writes those strings).
  function factorOf(catId, from, to, opts) {
    if (catId === "temp" || catId === "fuel") return null;
    var r = convert(catId, from, to, 1, opts);
    return r.ok ? r.v : null;
  }

  var API = {
    DATA_VER: DATA_VER, RECENT_MAX: RECENT_MAX, TOMBS_MAX: TOMBS_MAX,
    PREC_DEF: PREC_DEF, PREC_MIN: PREC_MIN, PREC_MAX: PREC_MAX,
    PREFS_KEY: PREFS_KEY, RATES_KEY: RATES_KEY, DATA_KEY: DATA_KEY, RATES_URLS: RATES_URLS,
    CATS: CATS, INGREDIENTS: INGREDIENTS,
    cat: cat, unitsOf: unitsOf, unit: unit, convert: convert, needsDensity: needsDensity, ingredient: ingredient,
    parseInput: parseInput, formatNumber: formatNumber, clampPrec: clampPrec,
    fold: fold, unitName: unitName, catName: catName, currencyName: currencyName,
    aliasesOf: aliasesOf, matchUnits: matchUnits, parseQuery: parseQuery, partnerOf: partnerOf,
    favId: favId, recId: recId, mergeData: mergeData, emptyData: emptyData,
    toggleFav: toggleFav, isFav: isFav, addRecent: addRecent, clearRecent: clearRecent,
    setPrec: setPrec, precOf: precOf, favList: favList, recentList: recentList,
    readPrefs: readPrefs, pairOf: pairOf,
    readRates: readRates, storedRates: storedRates, ratesStale: ratesStale, factorOf: factorOf
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.UnitsCore = API;
})(typeof window !== "undefined" ? window : globalThis);
