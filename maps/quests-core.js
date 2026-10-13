// ============================================================
// orOS Maps — quests-core.js (StreetComplete-style quests, OSM
// upgrade wave 5, v1.0.0). Pure functions, no DOM, no network:
// Node-tested in tests/maps-quests.test.js. Uses poi-core.js
// (window.OrosMapsPoi) for tag cleaning.
//
//   - QUESTS: 36 questions (16 since wave 5, 20 more in maps wave 8) you can answer at a glance on the spot,
//     each with the elements it applies to (a pure test on the tags),
//     the Overpass selectors that fetch them, and the answers as tag
//     sets. No code or text from StreetComplete (GPL): the ideas are
//     common OSM tagging, written here from the OSM wiki.
//   - Re-survey: some quests come back when the answer is old (the
//     key's check_date:<key>, else check_date, else the element's
//     last edit). The answer then also sets check_date:<key>.
//   - Overpass query for the enabled quests in a box; strict parsing
//     (tags, centre, last edit time).
//   - answerSet(): an answer → { set, was } for the upload.
//   - The synced slice "mapsquests" (key oros-maps-quests-data):
//       { ver, answers{id: ans}, tombs{id: ts}, hide{"n123:qid": ts},
//         set{ m, off[qid…] }, done{ dev: { "YYYY-MM-DD": n } } }
//     ans = { id, m, dev, srv, q, t, oid, lat, lon, set, was, name, err? }
//     answers LWW by m (equal m → larger canonical JSON) + tombs
//     (tomb ≥ m drops); hide max ts per key; set LWW by m; done is a
//     counter per device and day (max), so two devices never double
//     count. Only the device in `dev` uploads an answer.
//
//   - Maps wave 8: each quest has a category (CATS) for the
//     achievements; team mapping splits the quests of an area between
//     2–12 people by the element id (teamKeeps), with no server.
//   - The synced slice "mapsqstats" (key oros-maps-qstats-data, own
//     slice since 1.65.00 so older devices never drop it):
//       { ver, cnt{ dev: { qid: n } }, team{ m, size, idx } }
//     cnt = answers uploaded per device and quest (max per device:
//     two devices never double count); team LWW by m.
//
// API: window.OrosMapsQuests (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";
  var P = root && root.OrosMapsPoi ? root.OrosMapsPoi :
    (typeof require === "function" ? require("./poi-core.js") : null);

  var VER = "1.2.0";
  var LIM = { answers: 500, tombs: 2000, hide: 3000, devs: 20, days: 400, els: 3000, name: 120, err: 200, text: 255 };
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var DEV_RE = /^[a-z0-9]{4,40}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var HIDE_RE = /^[nwr][1-9][0-9]{0,14}:[a-z_]{2,40}$/;
  var YEAR = 365.25 * 86400000;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okM(v) { return isNum(v) && v >= 0 && v <= 8.64e15 && Math.floor(v) === v; }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function inList(v, list) { return typeof v === "string" && list.indexOf(v) >= 0; }
  function re(list) { return "^(" + list.join("|") + ")$"; }

  // ---------- which elements ----------
  var OH_AMENITY = ["cafe", "restaurant", "fast_food", "bar", "pub", "bank", "pharmacy", "post_office", "library", "ice_cream", "bureau_de_change"];
  var WC_AMENITY = ["cafe", "restaurant", "fast_food", "bar", "pub", "bank", "pharmacy", "post_office", "library", "cinema", "theatre", "townhall", "clinic", "doctors", "dentist", "hospital", "ice_cream"];
  var SMOKE_AMENITY = ["bar", "pub", "cafe", "restaurant", "fast_food", "nightclub", "biergarten"];
  var LIT_HW = ["residential", "living_street", "pedestrian", "footway", "cycleway", "steps"];
  var SURF_HW = ["residential", "living_street", "pedestrian", "service", "track", "path", "footway", "cycleway", "unclassified", "bridleway"];
  var LEVEL_B = ["house", "detached", "semidetached_house", "terrace", "residential", "apartments", "commercial", "retail", "office", "hotel", "yes"];
  var NUM_B = ["house", "detached", "semidetached_house", "terrace", "apartments", "residential"];
  // wave 8
  var SPEED_HW = ["residential", "tertiary", "secondary", "primary", "unclassified", "living_street"];
  var NAME_HW = ["residential", "tertiary", "secondary", "primary", "unclassified", "living_street", "pedestrian"];
  var DIET_AMENITY = ["restaurant", "cafe", "fast_food"];
  var PAY_AMENITY = ["cafe", "restaurant", "fast_food", "bar", "pub", "pharmacy", "fuel", "ice_cream"];
  var WIFI_AMENITY = ["cafe", "restaurant", "fast_food", "bar", "pub", "library"];
  function shopOpen(t) { return !!t.shop && t.shop !== "vacant" && t.shop !== "no"; }
  function named(t) { return !!(t.name || t.brand); }
  function busStop(t) { return t.highway === "bus_stop" || (t.public_transport === "platform" && t.bus === "yes"); }
  function hasPrefix(t, p) { for (var k in t) if (k.indexOf(p) === 0) return true; return false; }
  function pub(t) { return t.access !== "private" && t.access !== "no"; }

  function o(v, en, el, set) { return { v: v, en: en, el: el, set: set }; }
  function yn(key, yesEn, yesEl, noEn, noEl) {
    var s1 = {}, s2 = {}; s1[key] = "yes"; s2[key] = "no";
    return [o("yes", yesEn || "Yes", yesEl || "Ναι", s1), o("no", noEn || "No", noEl || "Όχι", s2)];
  }

  // kind: choice (one tap) · multi (tick, then Save) · hours · number · text
  var QUESTS = [
    { id: "opening_hours", icon: "🕒", kind: "hours", key: "opening_hours", recheck: 1,
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(OH_AMENITY) + '"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, OH_AMENITY)) && named(t) && t["opening_hours:signed"] !== "no"; },
      title: { en: "Opening hours", el: "Ωράριο" },
      q: { en: "When is {name} open?", el: "Πότε είναι ανοιχτό το {name};" } },
    { id: "wheelchair", icon: "♿", kind: "choice", key: "wheelchair", recheck: 4,
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(WC_AMENITY) + '"]', 'nwr["tourism"~"^(hotel|museum)$"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, WC_AMENITY) || inList(t.tourism, ["hotel", "museum"])) && named(t); },
      title: { en: "Wheelchair access", el: "Πρόσβαση με αμαξίδιο" },
      q: { en: "Can you get into {name} in a wheelchair?", el: "Μπαίνει κανείς στο {name} με αμαξίδιο;" },
      options: [o("yes", "Yes, fully", "Ναι, πλήρως", { wheelchair: "yes" }), o("limited", "Partly (a small step, help needed)", "Εν μέρει (ένα σκαλάκι, χρειάζεται βοήθεια)", { wheelchair: "limited" }),
        o("no", "No", "Όχι", { wheelchair: "no" })] },
    { id: "bench_backrest", icon: "🪑", kind: "choice", key: "backrest",
      sel: ['node["amenity"="bench"]', 'node["leisure"="picnic_table"]["bench"="yes"]'],
      applies: function (t) { return t.amenity === "bench"; },
      title: { en: "Bench backrest", el: "Πλάτη στο παγκάκι" },
      q: { en: "Does this bench have a backrest?", el: "Έχει πλάτη αυτό το παγκάκι;" },
      options: yn("backrest") },
    { id: "bus_shelter", icon: "🚏", kind: "choice", key: "shelter", recheck: 4,
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t); },
      title: { en: "Bus stop shelter", el: "Στέγαστρο στάσης" },
      q: { en: "Does this bus stop have a shelter?", el: "Έχει στέγαστρο αυτή η στάση;" },
      options: yn("shelter") },
    { id: "bus_bench", icon: "🚌", kind: "choice", key: "bench", recheck: 4,
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t); },
      title: { en: "Bench at the bus stop", el: "Παγκάκι στη στάση" },
      q: { en: "Is there a bench at this bus stop?", el: "Υπάρχει παγκάκι σε αυτή τη στάση;" },
      options: yn("bench") },
    { id: "crossing_type", icon: "🚸", kind: "choice", key: "crossing", recheck: 8,
      sel: ['node["highway"="crossing"]'],
      applies: function (t) { return t.highway === "crossing" && t.crossing !== "no" && t.crossing !== "informal"; },
      title: { en: "Crossing type", el: "Είδος διάβασης" },
      q: { en: "What kind of crossing is this?", el: "Τι διάβαση είναι αυτή;" },
      options: [o("traffic_signals", "With traffic lights", "Με φανάρι", { crossing: "traffic_signals" }),
        o("marked", "Marked (zebra), no lights", "Διαγράμμιση (ζέβρα), χωρίς φανάρι", { crossing: "uncontrolled", "crossing:markings": "yes" }),
        o("unmarked", "No markings", "Χωρίς διαγράμμιση", { crossing: "unmarked", "crossing:markings": "no" })] },
    { id: "way_lit", icon: "💡", kind: "choice", key: "lit", recheck: 8,
      sel: ['way["highway"~"' + re(LIT_HW) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, LIT_HW) && t.indoor !== "yes"; },
      title: { en: "Street lights", el: "Φωτισμός δρόμου" },
      q: { en: "Is {name} lit at night?", el: "Φωτίζεται τη νύχτα: {name};" },
      options: yn("lit", "Yes, it has street lights", "Ναι, έχει φώτα", "No", "Όχι") },
    { id: "way_surface", icon: "🛣️", kind: "choice", key: "surface", recheck: 8,
      sel: ['way["highway"~"' + re(SURF_HW) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, SURF_HW) && t.indoor !== "yes"; },
      title: { en: "Surface", el: "Επιφάνεια" },
      q: { en: "What is the surface of {name}?", el: "Τι επιφάνεια έχει: {name};" },
      options: [["asphalt", "Asphalt", "Άσφαλτος"], ["concrete", "Concrete", "Μπετόν"], ["paving_stones", "Paving stones", "Πλάκες / κυβόλιθοι"],
        ["sett", "Cobblestones (sett)", "Καλντερίμι"], ["compacted", "Compacted gravel", "Πατημένο χαλίκι"], ["gravel", "Loose gravel", "Χαλίκι"],
        ["ground", "Bare ground", "Χώμα"], ["grass", "Grass", "Χορτάρι"], ["sand", "Sand", "Άμμος"]]
        .map(function (x) { return o(x[0], x[1], x[2], { surface: x[0] }); }) },
    { id: "toilets_fee", icon: "🚻", kind: "choice", key: "fee", recheck: 4,
      sel: ['nwr["amenity"="toilets"]'],
      applies: function (t) { return t.amenity === "toilets" && t.access !== "private" && t.access !== "customers"; },
      title: { en: "Toilets fee", el: "Χρέωση τουαλέτας" },
      q: { en: "Do these toilets cost money?", el: "Έχουν χρέωση αυτές οι τουαλέτες;" },
      options: yn("fee", "Yes, you pay", "Ναι, πληρώνεις", "No, free", "Όχι, δωρεάν") },
    { id: "recycling", icon: "♻️", kind: "multi",
      sel: ['nwr["amenity"="recycling"]'],
      applies: function (t) { return t.amenity === "recycling" && t.recycling_type !== "centre" && !hasPrefix(t, "recycling:"); },
      title: { en: "Recycling", el: "Ανακύκλωση" },
      q: { en: "What can you recycle here?", el: "Τι ανακυκλώνεται εδώ;" },
      options: [["glass_bottles", "Glass bottles", "Γυάλινα μπουκάλια"], ["paper", "Paper", "Χαρτί"], ["plastic", "Plastic", "Πλαστικό"],
        ["cans", "Cans", "Κουτάκια"], ["clothes", "Clothes", "Ρούχα"], ["batteries", "Batteries", "Μπαταρίες"],
        ["small_appliances", "Small appliances", "Μικρές συσκευές"], ["cooking_oil", "Cooking oil", "Μαγειρικό λάδι"]]
        .map(function (x) { var s = {}; s["recycling:" + x[0]] = "yes"; return o(x[0], x[1], x[2], s); }) },
    { id: "religion", icon: "🛐", kind: "choice", key: "religion",
      sel: ['nwr["amenity"="place_of_worship"]'],
      applies: function (t) { return t.amenity === "place_of_worship"; },
      title: { en: "Religion", el: "Θρήσκευμα" },
      q: { en: "Which religion is {name} for?", el: "Σε ποιο θρήσκευμα ανήκει: {name};" },
      options: [["christian", "Christian", "Χριστιανικό"], ["muslim", "Muslim", "Μουσουλμανικό"], ["jewish", "Jewish", "Εβραϊκό"],
        ["buddhist", "Buddhist", "Βουδιστικό"], ["hindu", "Hindu", "Ινδουιστικό"], ["multifaith", "For several religions", "Για πολλά θρησκεύματα"]]
        .map(function (x) { return o(x[0], x[1], x[2], { religion: x[0] }); }) },
    { id: "building_levels", icon: "🏢", kind: "number", key: "building:levels", min: 1, max: 200,
      sel: ['way["building"~"' + re(LEVEL_B) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.building, LEVEL_B) && !t["building:part"]; },
      title: { en: "Building floors", el: "Όροφοι κτιρίου" },
      q: { en: "How many floors does this building have above the ground (ground floor included, roof not)?", el: "Πόσους ορόφους έχει πάνω από το έδαφος (μαζί με το ισόγειο, χωρίς τη σοφίτα);" } },
    { id: "housenumber", icon: "🔢", kind: "text", key: "addr:housenumber", maxLen: 20,
      sel: ['way["building"~"' + re(NUM_B) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.building, NUM_B) && !t["addr:housename"] && t.nohousenumber !== "yes" && !t["addr:conscriptionnumber"]; },
      title: { en: "House number", el: "Αριθμός" },
      q: { en: "What is the house number of this building?", el: "Τι αριθμό έχει αυτό το κτίριο;" },
      none: o("none", "It has no number", "Δεν έχει αριθμό", { nohousenumber: "yes" }) },
    { id: "playground_access", icon: "🛝", kind: "choice", key: "access",
      sel: ['nwr["leisure"="playground"]'],
      applies: function (t) { return t.leisure === "playground"; },
      title: { en: "Playground access", el: "Πρόσβαση στην παιδική χαρά" },
      q: { en: "Who can use this playground?", el: "Ποιος μπορεί να χρησιμοποιήσει αυτή την παιδική χαρά;" },
      options: [o("yes", "Everyone", "Όλοι", { access: "yes" }), o("customers", "Only customers", "Μόνο πελάτες", { access: "customers" }),
        o("private", "Private (residents only)", "Ιδιωτική (μόνο κάτοικοι)", { access: "private" })] },
    { id: "smoking", icon: "🚬", kind: "choice", key: "smoking", recheck: 2,
      sel: ['nwr["amenity"~"' + re(SMOKE_AMENITY) + '"]'],
      applies: function (t) { return inList(t.amenity, SMOKE_AMENITY) && named(t); },
      title: { en: "Smoking", el: "Κάπνισμα" },
      q: { en: "Is smoking allowed at {name}?", el: "Επιτρέπεται το κάπνισμα στο {name};" },
      options: [o("no", "No", "Όχι", { smoking: "no" }), o("outside", "Only outside", "Μόνο έξω", { smoking: "outside" }),
        o("separated", "In a separate room", "Σε χωριστό χώρο", { smoking: "separated" }), o("yes", "Yes, inside too", "Ναι, και μέσα", { smoking: "yes" })] },
    { id: "bank_atm", icon: "🏧", kind: "choice", key: "atm", recheck: 4,
      sel: ['nwr["amenity"="bank"]'],
      applies: function (t) { return t.amenity === "bank"; },
      title: { en: "ATM at the bank", el: "ΑΤΜ στην τράπεζα" },
      q: { en: "Does {name} have an ATM?", el: "Έχει ΑΤΜ: {name};" },
      options: yn("atm") },

    // ---------- maps wave 8: 20 more ----------
    { id: "maxspeed", icon: "🚦", kind: "number", key: "maxspeed", min: 5, max: 130, cat: "streets",
      sel: ['way["highway"~"' + re(SPEED_HW) + '"][!"maxspeed"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, SPEED_HW) && !t["maxspeed:type"] && !t["source:maxspeed"]; },
      title: { en: "Speed limit", el: "Όριο ταχύτητας" },
      q: { en: "What speed limit is signed on {name} (km/h)? Answer only if you see a sign.", el: "Τι όριο ταχύτητας γράφει η πινακίδα στο {name} (χλμ./ώρα); Απάντησε μόνο αν βλέπεις πινακίδα." } },
    { id: "road_name", icon: "🏷️", kind: "name", key: "name", maxLen: 80, cat: "streets",
      sel: ['way["highway"~"' + re(NAME_HW) + '"][!"name"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, NAME_HW) && t.noname !== "yes" && !t.ref && t.area !== "yes"; },
      title: { en: "Street name", el: "Όνομα δρόμου" },
      q: { en: "What is the name of this street, as on the sign?", el: "Πώς λέγεται αυτός ο δρόμος, όπως γράφει η πινακίδα;" },
      none: o("none", "It has no name", "Δεν έχει όνομα", { noname: "yes" }) },
    { id: "steps_count", icon: "🪜", kind: "number", key: "step_count", min: 1, max: 500, cat: "streets",
      sel: ['way["highway"="steps"][!"step_count"]'],
      applies: function (t, el) { return el.t === "w" && t.highway === "steps" && t.indoor !== "yes"; },
      title: { en: "Number of steps", el: "Πόσα σκαλιά" },
      q: { en: "How many steps are there?", el: "Πόσα σκαλιά έχει;" } },
    { id: "steps_handrail", icon: "🤚", kind: "choice", key: "handrail", recheck: 8, cat: "streets",
      sel: ['way["highway"="steps"]'],
      applies: function (t, el) { return el.t === "w" && t.highway === "steps" && !hasPrefix(t, "handrail:"); },
      title: { en: "Handrail", el: "Κουπαστή" },
      q: { en: "Do these steps have a handrail?", el: "Έχουν κουπαστή αυτά τα σκαλιά;" },
      options: yn("handrail") },
    { id: "tactile_paving", icon: "🦯", kind: "choice", key: "tactile_paving", recheck: 8, cat: "transit",
      sel: ['node["highway"="crossing"]'],
      applies: function (t) { return t.highway === "crossing" && t.crossing !== "no" && t.crossing !== "informal"; },
      title: { en: "Tactile paving at the crossing", el: "Όδευση τυφλών στη διάβαση" },
      q: { en: "Is there tactile paving (raised bumps) on both sides of this crossing?", el: "Υπάρχει όδευση τυφλών (ανάγλυφες πλάκες) και στις δύο πλευρές της διάβασης;" },
      options: [o("yes", "Yes", "Ναι", { tactile_paving: "yes" }), o("incorrect", "Only on one side, or wrongly laid", "Μόνο στη μία πλευρά ή λάθος τοποθετημένη", { tactile_paving: "incorrect" }),
        o("no", "No", "Όχι", { tactile_paving: "no" })] },
    { id: "stop_name", icon: "🪧", kind: "name", key: "name", maxLen: 80, cat: "transit",
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t) && t.noname !== "yes" && t["name:signed"] !== "no"; },
      title: { en: "Stop name", el: "Όνομα στάσης" },
      q: { en: "What is the name of this stop, as on its sign?", el: "Πώς λέγεται αυτή η στάση, όπως γράφει η πινακίδα;" },
      none: o("none", "No name on the sign", "Η πινακίδα δεν έχει όνομα", { "name:signed": "no" }) },
    { id: "level_crossing_barrier", icon: "🚧", kind: "choice", key: "crossing:barrier", recheck: 8, cat: "transit",
      sel: ['node["railway"="level_crossing"]'],
      applies: function (t) { return t.railway === "level_crossing"; },
      title: { en: "Level crossing barrier", el: "Μπάρα στην ισόπεδη διάβαση" },
      q: { en: "What barrier does this railway crossing have?", el: "Τι μπάρα έχει αυτή η σιδηροδρομική διάβαση;" },
      options: [o("no", "None", "Καμία", { "crossing:barrier": "no" }), o("half", "Half barriers", "Μισές μπάρες", { "crossing:barrier": "half" }),
        o("full", "Full barriers", "Μπάρες σε όλο το πλάτος", { "crossing:barrier": "full" }), o("gate", "Gates", "Πύλες", { "crossing:barrier": "gate" })] },
    { id: "parking_fee", icon: "🅿️", kind: "choice", key: "fee", recheck: 4, cat: "parking",
      sel: ['nwr["amenity"="parking"]'],
      applies: function (t) { return t.amenity === "parking" && pub(t) && t.access !== "customers"; },
      title: { en: "Parking fee", el: "Χρέωση στάθμευσης" },
      q: { en: "Do you have to pay to park here?", el: "Πληρώνεις για να παρκάρεις εδώ;" },
      options: yn("fee", "Yes, you pay", "Ναι, πληρώνεις", "No, free", "Όχι, δωρεάν") },
    { id: "parking_type", icon: "🚗", kind: "choice", key: "parking", cat: "parking",
      sel: ['nwr["amenity"="parking"][!"parking"]'],
      applies: function (t) { return t.amenity === "parking"; },
      title: { en: "Kind of car park", el: "Είδος πάρκινγκ" },
      q: { en: "What kind of car park is this?", el: "Τι πάρκινγκ είναι αυτό;" },
      options: [o("surface", "Open-air lot", "Υπαίθριο", { parking: "surface" }), o("multi-storey", "Multi-storey", "Πολυώροφο", { parking: "multi-storey" }),
        o("underground", "Underground", "Υπόγειο", { parking: "underground" }), o("street_side", "Bays beside the street", "Θέσεις στην άκρη του δρόμου", { parking: "street_side" })] },
    { id: "bike_parking_capacity", icon: "🚲", kind: "number", key: "capacity", min: 1, max: 1000, cat: "parking",
      sel: ['nwr["amenity"="bicycle_parking"][!"capacity"]'],
      applies: function (t) { return t.amenity === "bicycle_parking"; },
      title: { en: "Bicycle parking spaces", el: "Θέσεις ποδηλάτων" },
      q: { en: "How many bicycles can be parked here?", el: "Πόσα ποδήλατα χωράνε εδώ;" } },
    { id: "bike_parking_covered", icon: "☂️", kind: "choice", key: "covered", recheck: 8, cat: "parking",
      sel: ['nwr["amenity"="bicycle_parking"]'],
      applies: function (t) { return t.amenity === "bicycle_parking" && t.bicycle_parking !== "building"; },
      title: { en: "Covered bicycle parking", el: "Στέγαστρο ποδηλάτων" },
      q: { en: "Is this bicycle parking covered?", el: "Έχει στέγαστρο αυτή η θέση ποδηλάτων;" },
      options: yn("covered") },
    { id: "diet_vegetarian", icon: "🥗", kind: "choice", key: "diet:vegetarian", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(DIET_AMENITY) + '"]'],
      applies: function (t) { return inList(t.amenity, DIET_AMENITY) && named(t) && t["diet:vegan"] !== "only"; },
      title: { en: "Vegetarian food", el: "Χορτοφαγικό φαγητό" },
      q: { en: "Does {name} serve vegetarian dishes?", el: "Σερβίρει χορτοφαγικά πιάτα το {name};" },
      options: [o("only", "Only vegetarian", "Μόνο χορτοφαγικά", { "diet:vegetarian": "only" }), o("yes", "Yes, several", "Ναι, αρκετά", { "diet:vegetarian": "yes" }),
        o("limited", "A few", "Λίγα", { "diet:vegetarian": "limited" }), o("no", "No", "Όχι", { "diet:vegetarian": "no" })] },
    { id: "diet_vegan", icon: "🌱", kind: "choice", key: "diet:vegan", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(DIET_AMENITY) + '"]["diet:vegetarian"~"^(yes|only|limited)$"]'],
      applies: function (t) { return inList(t.amenity, DIET_AMENITY) && named(t) && inList(t["diet:vegetarian"], ["yes", "only", "limited"]); },
      title: { en: "Vegan food", el: "Vegan φαγητό" },
      q: { en: "Does {name} serve vegan dishes?", el: "Σερβίρει vegan πιάτα το {name};" },
      options: [o("only", "Only vegan", "Μόνο vegan", { "diet:vegan": "only" }), o("yes", "Yes, several", "Ναι, αρκετά", { "diet:vegan": "yes" }),
        o("limited", "A few", "Λίγα", { "diet:vegan": "limited" }), o("no", "No", "Όχι", { "diet:vegan": "no" })] },
    { id: "payment", icon: "💳", kind: "multi", cat: "places",
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(PAY_AMENITY) + '"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, PAY_AMENITY)) && named(t) && !hasPrefix(t, "payment:"); },
      title: { en: "Ways to pay", el: "Τρόποι πληρωμής" },
      q: { en: "How can you pay at {name}?", el: "Πώς πληρώνεις στο {name};" },
      options: [["cash", "Cash", "Μετρητά"], ["debit_cards", "Debit cards", "Χρεωστική κάρτα"], ["credit_cards", "Credit cards", "Πιστωτική κάρτα"],
        ["contactless", "Contactless (tap)", "Ανέπαφα"]]
        .map(function (x) { var st = {}; st["payment:" + x[0]] = "yes"; return o(x[0], x[1], x[2], st); }) },
    { id: "internet_access", icon: "📶", kind: "choice", key: "internet_access", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(WIFI_AMENITY) + '"]', 'nwr["tourism"="hotel"]'],
      applies: function (t) { return (inList(t.amenity, WIFI_AMENITY) || t.tourism === "hotel") && named(t); },
      title: { en: "Wi-Fi", el: "Wi-Fi" },
      q: { en: "Does {name} offer Wi-Fi to customers?", el: "Έχει Wi-Fi για τους πελάτες το {name};" },
      options: [o("wlan", "Yes", "Ναι", { internet_access: "wlan" }), o("no", "No", "Όχι", { internet_access: "no" })] },
    { id: "toilets_wheelchair", icon: "🚾", kind: "choice", key: "wheelchair", recheck: 4, cat: "things",
      sel: ['nwr["amenity"="toilets"]'],
      applies: function (t) { return t.amenity === "toilets" && pub(t); },
      title: { en: "Wheelchair toilet", el: "Τουαλέτα για αμαξίδιο" },
      q: { en: "Can these toilets be used from a wheelchair?", el: "Μπορεί να τις χρησιμοποιήσει κάποιος με αμαξίδιο;" },
      options: [o("yes", "Yes", "Ναι", { wheelchair: "yes" }), o("limited", "Partly", "Εν μέρει", { wheelchair: "limited" }), o("no", "No", "Όχι", { wheelchair: "no" })] },
    { id: "aed_indoor", icon: "❤️", kind: "choice", key: "indoor", cat: "things",
      sel: ['node["emergency"="defibrillator"][!"indoor"]'],
      applies: function (t) { return t.emergency === "defibrillator"; },
      title: { en: "Defibrillator", el: "Απινιδωτής" },
      q: { en: "Is this defibrillator (AED) inside a building?", el: "Αυτός ο απινιδωτής είναι μέσα σε κτίριο;" },
      options: yn("indoor", "Yes, inside", "Ναι, μέσα", "No, outside", "Όχι, έξω") },
    { id: "fire_hydrant_type", icon: "🧯", kind: "choice", key: "fire_hydrant:type", cat: "things",
      sel: ['node["emergency"="fire_hydrant"][!"fire_hydrant:type"]'],
      applies: function (t) { return t.emergency === "fire_hydrant"; },
      title: { en: "Fire hydrant", el: "Πυροσβεστικός κρουνός" },
      q: { en: "What kind of fire hydrant is this?", el: "Τι κρουνός είναι αυτός;" },
      options: [o("pillar", "Pillar above the ground", "Κολόνα πάνω από το έδαφος", { "fire_hydrant:type": "pillar" }),
        o("underground", "Underground (a lid in the street)", "Υπόγειος (καπάκι στον δρόμο)", { "fire_hydrant:type": "underground" }),
        o("wall", "On a wall", "Σε τοίχο", { "fire_hydrant:type": "wall" })] },
    { id: "postbox_times", icon: "📮", kind: "hours", key: "collection_times", recheck: 2, cat: "things",
      sel: ['node["amenity"="post_box"]'],
      applies: function (t) { return t.amenity === "post_box" && t["collection_times:signed"] !== "no"; },
      title: { en: "Postbox collection times", el: "Ώρες αποκομιδής" },
      q: { en: "When is this postbox emptied?", el: "Πότε αδειάζει αυτό το γραμματοκιβώτιο;" } },
    { id: "building_type", icon: "🏠", kind: "choice", key: "building", blank: "yes", cat: "buildings",
      sel: ['way["building"="yes"]'],
      applies: function (t, el) { return el.t === "w" && t.building === "yes" && !t["building:part"] && !t.amenity && !t.shop; },
      title: { en: "Kind of building", el: "Είδος κτιρίου" },
      q: { en: "What kind of building is this?", el: "Τι κτίριο είναι αυτό;" },
      options: [["house", "House", "Μονοκατοικία"], ["apartments", "Apartment block", "Πολυκατοικία"], ["commercial", "Offices or shops", "Γραφεία ή καταστήματα"],
        ["industrial", "Industrial", "Βιομηχανικό"], ["garage", "Garage", "Γκαράζ"], ["shed", "Shed", "Αποθήκη"],
        ["school", "School", "Σχολείο"], ["church", "Church", "Εκκλησία"], ["ruins", "Ruins", "Ερείπιο"]]
        .map(function (x) { return o(x[0], x[1], x[2], { building: x[0] }); }) }
  ];
  var OLD_CAT = { opening_hours: "places", wheelchair: "places", smoking: "places", bank_atm: "places", religion: "places",
    way_lit: "streets", way_surface: "streets", bus_shelter: "transit", bus_bench: "transit", crossing_type: "transit",
    building_levels: "buildings", housenumber: "buildings", bench_backrest: "things", toilets_fee: "things",
    recycling: "things", playground_access: "things" };
  // Answers made from an overlay (overlays-core.js, maps wave 8B) that no
  // pin asks: valid in the slice and counted, never in QUESTS.
  var OVERLAY_ONLY = [
    { id: "sidewalk", icon: "🚶", kind: "overlay", key: "sidewalk", cat: "streets", sel: [],
      applies: function () { return false; },
      title: { en: "Sidewalks", el: "Πεζοδρόμια" } }
  ];
  var BY_ID = {};
  QUESTS.forEach(function (q) { BY_ID[q.id] = q; if (!q.cat) q.cat = OLD_CAT[q.id]; });
  OVERLAY_ONLY.forEach(function (q) { BY_ID[q.id] = q; });

  // ---------- dates ----------
  function today(ms) {
    var d = new Date(isNum(ms) ? ms : Date.now());
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function parseDay(s) {
    if (typeof s !== "string") return 0;
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s.trim());
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
    return isFinite(t) ? t : 0;
  }
  // When the key was last confirmed: check_date:<key>, check_date, else the element's last edit.
  function lastCheck(el, key) {
    var t = el.tags || {};
    return parseDay(t["check_date:" + key]) || parseDay(t.check_date) || parseDay(t["survey:date"]) || (isNum(el.ts) ? el.ts : 0);
  }

  // Quest state for one element: null (not asked), "new" or "recheck".
  function state(q, el, now) {
    var t = el.tags || {};
    if (!q.applies(t, el)) return null;
    if (q.kind === "multi") return "new";
    var has = (t[q.key] !== undefined && t[q.key] !== q.blank) || (q.none && Object.keys(q.none.set).some(function (k) { return t[k] !== undefined; }));
    if (!has) return "new";
    if (!q.recheck) return null;
    var last = lastCheck(el, q.key);
    if (!last) return null;
    return (isNum(now) ? now : Date.now()) - last > q.recheck * YEAR ? "recheck" : null;
  }
  // Open quests for a list of elements: [{ q, el, mode }], in the user's
  // order, without hidden ones. off: quest ids turned off.
  function openQuests(els, opts) {
    opts = opts || {};
    var off = {}, hide = opts.hide || {}, now = opts.now, out = [];
    (opts.off || []).forEach(function (id) { off[id] = 1; });
    (els || []).forEach(function (el) {
      QUESTS.forEach(function (q) {
        if (off[q.id] || hide[el.t + el.id + ":" + q.id]) return;
        var s = state(q, el, now);
        if (s) out.push({ q: q, el: el, mode: s });
      });
    });
    return out;
  }

  // ---------- answers → tags ----------
  // value: option v (choice), [v…] (multi), string (hours / text), number,
  // or "same" (re-survey: still the same). → { set, was } or null.
  var HOURS_RE = /^[A-Za-z0-9 :;,\-+\/\[\]"().]{1,255}$/;
  function answerSet(q, el, value, now) {
    var t = el.tags || {}, set = {};
    var mode = state(q, el, now) || "new";
    if (value === "same") {
      if (mode !== "recheck") return null;
    } else if (q.kind === "choice") {
      var opt = (q.options || []).filter(function (x) { return x.v === value; })[0];
      if (!opt) return null;
      Object.keys(opt.set).forEach(function (k) { set[k] = opt.set[k]; });
    } else if (q.kind === "multi") {
      if (!Array.isArray(value) || !value.length) return null;
      var ok = 0;
      (q.options || []).forEach(function (x) { if (value.indexOf(x.v) >= 0) { Object.keys(x.set).forEach(function (k) { set[k] = x.set[k]; }); ok++; } });
      if (!ok) return null;
    } else if (q.kind === "hours") {
      if (value === "24/7") set[q.key] = "24/7";
      else if (value === "unsigned") set[q.key + ":signed"] = "no";
      else {
        var s = P.cleanVal(String(value || ""), LIM.text);
        if (!HOURS_RE.test(s)) return null;
        set[q.key] = s;
      }
    } else if (q.kind === "number") {
      var n = typeof value === "number" ? value : parseInt(String(value || "").trim(), 10);
      if (!isNum(n) || Math.floor(n) !== n || n < q.min || n > q.max || !/^\s*\d+\s*$/.test(String(value))) return null;
      set[q.key] = String(n);
    } else if (q.kind === "text") {
      if (value === "none" && q.none) Object.keys(q.none.set).forEach(function (k) { set[k] = q.none.set[k]; });
      else {
        var v = P.cleanVal(String(value || ""), q.maxLen || 40);
        if (!v || !/^[0-9A-Za-zͰ-Ͽἀ-῿/\-\s,;]+$/.test(v) || !/\d/.test(v)) return null;
        set[q.key] = v;
      }
    } else if (q.kind === "name") {
      if (value === "none" && q.none) Object.keys(q.none.set).forEach(function (k) { set[k] = q.none.set[k]; });
      else {
        var nm = P.cleanVal(String(value || ""), q.maxLen || 80);
        // letters (any script) are required; no tag syntax or links
        if (!nm || !/\p{L}/u.test(nm) || /[<>{}=|\\]|https?:/i.test(nm)) return null;
        set[q.key] = nm;
      }
    } else return null;
    if (mode === "recheck" && q.key) set["check_date:" + q.key] = today(now);
    var was = {};
    Object.keys(set).forEach(function (k) {
      var cur = t[k] === undefined ? "" : t[k];
      if (cur === set[k] && k.indexOf("check_date") !== 0) delete set[k]; else was[k] = cur;
    });
    if (!Object.keys(set).length) return null;
    return { set: set, was: was };
  }

  // ---------- Overpass ----------
  function overpassQuery(s, w, n, e, off) {
    var b = [s, w, n, e].map(function (v) { return (+v).toFixed(6); }).join(",");
    var seen = {}, offs = {}, q = "[out:json][timeout:25];(";
    (off || []).forEach(function (id) { offs[id] = 1; });
    QUESTS.forEach(function (qq) {
      if (offs[qq.id]) return;
      qq.sel.forEach(function (sel) { if (!seen[sel]) { seen[sel] = 1; q += sel + "(" + b + ");"; } });
    });
    return q + ");out meta center qt " + LIM.els + ";";
  }
  function parseOverpass(json) {
    var out = [];
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    els.forEach(function (x) {
      if (!x || ["node", "way", "relation"].indexOf(x.type) < 0) return;
      if (!isNum(x.id) || x.id <= 0 || Math.floor(x.id) !== x.id) return;
      var lat = x.type === "node" ? x.lat : x.center && x.center.lat;
      var lon = x.type === "node" ? x.lon : x.center && x.center.lon;
      if (!okLat(lat) || !okLon(lon)) return;
      var ts = typeof x.timestamp === "string" ? Date.parse(x.timestamp) : NaN;
      out.push({ t: x.type.charAt(0), id: x.id, lat: lat, lon: lon, tags: P.cleanTags(x.tags || {}), ts: isFinite(ts) ? ts : 0 });
    });
    return out.slice(0, LIM.els);
  }

  // ---------- slice "mapsquests" ----------
  function normAnswer(a) {
    if (!a || typeof a !== "object") return null;
    if (typeof a.id !== "string" || !ID_RE.test(a.id) || !okM(a.m)) return null;
    if (typeof a.dev !== "string" || !DEV_RE.test(a.dev) || !BY_ID[a.q]) return null;
    if (["n", "w", "r"].indexOf(a.t) < 0 || !isNum(a.oid) || a.oid <= 0 || Math.floor(a.oid) !== a.oid) return null;
    if (!okLat(a.lat) || !okLon(a.lon)) return null;
    var o = { id: a.id, m: a.m, dev: a.dev, srv: a.srv === "dev" ? "dev" : "live", q: a.q, t: a.t, oid: a.oid,
      lat: Math.round(a.lat * 1e7) / 1e7, lon: Math.round(a.lon * 1e7) / 1e7 };
    var set = {}, was = {}, n = 0;
    Object.keys(a.set && typeof a.set === "object" ? a.set : {}).sort().forEach(function (k) {
      var ck = P.cleanKey(k);
      if (!ck || ck !== k || n >= 20 || typeof a.set[k] !== "string") return;
      var v = P.cleanVal(a.set[k]);
      if (!v) return;
      set[k] = v; n++;
      was[k] = a.was && typeof a.was[k] === "string" ? P.cleanVal(a.was[k]) : "";
    });
    if (!n) return null;
    o.set = set; o.was = was;
    o.name = P.cleanVal(a.name, LIM.name);
    var err = P.cleanVal(a.err, LIM.err);
    if (err) o.err = err;
    return o;
  }
  function normalize(data) {
    var out = { ver: 1, answers: {}, tombs: {}, hide: {}, set: { m: 0, off: [] }, done: {} };
    if (!data || typeof data !== "object") return out;
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var tombs = {};
    Object.keys(t).forEach(function (id) { if (ID_RE.test(id) && okM(t[id])) tombs[id] = t[id]; });
    capKeep(tombs, LIM.tombs).forEach(function (id) { out.tombs[id] = tombs[id]; });
    var src = data.answers && typeof data.answers === "object" ? data.answers : {}, ok = {};
    Object.keys(src).forEach(function (k) {
      var a = normAnswer(src[k]);
      if (!a || a.id !== k) return;
      if (out.tombs[k] !== undefined && out.tombs[k] >= a.m) return;
      ok[k] = a;
    });
    Object.keys(ok).sort(function (a, b) { return ok[b].m - ok[a].m || (a < b ? -1 : 1); })
      .slice(0, LIM.answers).sort().forEach(function (id) { out.answers[id] = ok[id]; });
    var h = data.hide && typeof data.hide === "object" ? data.hide : {}, hide = {};
    Object.keys(h).forEach(function (k) { if (HIDE_RE.test(k) && BY_ID[k.split(":")[1]] && okM(h[k])) hide[k] = h[k]; });
    capKeep(hide, LIM.hide).forEach(function (k) { out.hide[k] = hide[k]; });
    var s = data.set && typeof data.set === "object" ? data.set : {};
    if (okM(s.m)) {
      out.set.m = s.m;
      out.set.off = (Array.isArray(s.off) ? s.off : []).filter(function (id, i, a) { return BY_ID[id] && a.indexOf(id) === i; }).sort();
    }
    var d = data.done && typeof data.done === "object" ? data.done : {};
    Object.keys(d).filter(function (dev) { return DEV_RE.test(dev) && d[dev] && typeof d[dev] === "object"; }).sort().slice(0, LIM.devs).forEach(function (dev) {
      var days = {};
      Object.keys(d[dev]).filter(function (k) { return DAY_RE.test(k) && okM(d[dev][k]) && d[dev][k] > 0 && d[dev][k] <= 100000; })
        .sort().reverse().slice(0, LIM.days).sort().forEach(function (k) { days[k] = d[dev][k]; });
      if (Object.keys(days).length) out.done[dev] = days;
    });
    return out;
  }
  // newest `max` keys of a { key: ts } map, sorted
  function capKeep(map, max) {
    var ks = Object.keys(map);
    if (ks.length > max) ks = ks.sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); }).slice(0, max);
    return ks.sort();
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function merge(A, B) {
    var a = normalize(A), b = normalize(B);
    var out = { answers: {}, tombs: {}, hide: {}, set: null, done: {} };
    [a, b].forEach(function (x) {
      Object.keys(x.tombs).forEach(function (id) { out.tombs[id] = Math.max(out.tombs[id] || 0, x.tombs[id]); });
      Object.keys(x.answers).forEach(function (id) { out.answers[id] = newer(out.answers[id], x.answers[id]); });
      Object.keys(x.hide).forEach(function (k) { out.hide[k] = Math.max(out.hide[k] || 0, x.hide[k]); });
      Object.keys(x.done).forEach(function (dev) {
        var dd = out.done[dev] || (out.done[dev] = {});
        Object.keys(x.done[dev]).forEach(function (day) { dd[day] = Math.max(dd[day] || 0, x.done[dev][day]); });
      });
    });
    out.set = newer(a.set, b.set);
    return normalize(out);
  }

  // Totals of the done counters: { total, today, streak (days in a row up to today or yesterday) }
  function doneStats(data, now) {
    var d = normalize(data).done, per = {}, total = 0;
    Object.keys(d).forEach(function (dev) { Object.keys(d[dev]).forEach(function (day) { per[day] = (per[day] || 0) + d[dev][day]; total += d[dev][day]; }); });
    var t0 = isNum(now) ? now : Date.now(), td = today(t0), streak = 0;
    var cur = per[td] ? t0 : t0 - 86400000;
    while (per[today(cur)]) { streak++; cur -= 86400000; }
    return { total: total, today: per[td] || 0, streak: streak };
  }

  // ---------- maps wave 8: achievements, team, slice "mapsqstats" ----------
  var CATS = [
    { id: "places", icon: "🏪", en: "Shops and cafés", el: "Μαγαζιά και καφέ",
      links: ["https://wiki.openstreetmap.org/wiki/Key:opening_hours", "https://wiki.openstreetmap.org/wiki/Key:diet", "https://wiki.openstreetmap.org/wiki/Key:payment"] },
    { id: "streets", icon: "🛣️", en: "Streets and paths", el: "Δρόμοι και μονοπάτια",
      links: ["https://wiki.openstreetmap.org/wiki/Key:surface", "https://wiki.openstreetmap.org/wiki/Key:maxspeed", "https://wiki.openstreetmap.org/wiki/Key:lit"] },
    { id: "transit", icon: "🚏", en: "Stops and crossings", el: "Στάσεις και διαβάσεις",
      links: ["https://wiki.openstreetmap.org/wiki/Public_transport", "https://wiki.openstreetmap.org/wiki/Key:tactile_paving", "https://transitous.org/"] },
    { id: "parking", icon: "🅿️", en: "Parking", el: "Στάθμευση",
      links: ["https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking", "https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dbicycle_parking"] },
    { id: "buildings", icon: "🏢", en: "Buildings and addresses", el: "Κτίρια και διευθύνσεις",
      links: ["https://wiki.openstreetmap.org/wiki/Addresses", "https://wiki.openstreetmap.org/wiki/Key:building"] },
    { id: "things", icon: "🪑", en: "Street furniture", el: "Αστικός εξοπλισμός",
      links: ["https://wiki.openstreetmap.org/wiki/Street_furniture", "https://openaedmap.org/"] }
  ];
  var CAT_BY = {};
  CATS.forEach(function (c) { CAT_BY[c.id] = c; });
  var LEVELS = [1, 10, 30, 100, 300, 1000];
  var SLIM = { devs: 20 };
  function normStats(d) {
    var out = { ver: 1, cnt: {}, team: { m: 0, size: 1, idx: 0 } };
    if (!d || typeof d !== "object") return out;
    var c = d.cnt && typeof d.cnt === "object" ? d.cnt : {};
    Object.keys(c).filter(function (dev) { return DEV_RE.test(dev) && c[dev] && typeof c[dev] === "object"; }).sort().slice(0, SLIM.devs).forEach(function (dev) {
      var per = {};
      Object.keys(c[dev]).sort().forEach(function (qid) {
        // unknown quest ids are kept (a newer version may have them)
        if (/^[a-z_]{2,40}$/.test(qid) && okM(c[dev][qid]) && c[dev][qid] > 0 && c[dev][qid] <= 1000000) per[qid] = c[dev][qid];
      });
      if (Object.keys(per).length) out.cnt[dev] = per;
    });
    var tm = d.team && typeof d.team === "object" ? d.team : {};
    if (okM(tm.m) && isNum(tm.size) && Math.floor(tm.size) === tm.size && tm.size >= 1 && tm.size <= 12 &&
        isNum(tm.idx) && Math.floor(tm.idx) === tm.idx && tm.idx >= 0 && tm.idx < tm.size) {
      out.team = { m: tm.m, size: tm.size, idx: tm.idx };
    }
    return out;
  }
  function mergeStats(A, B) {
    var a = normStats(A), b = normStats(B), out = { cnt: {}, team: newer(a.team, b.team) };
    [a, b].forEach(function (x) {
      Object.keys(x.cnt).forEach(function (dev) {
        var dd = out.cnt[dev] || (out.cnt[dev] = {});
        Object.keys(x.cnt[dev]).forEach(function (q) { dd[q] = Math.max(dd[q] || 0, x.cnt[dev][q]); });
      });
    });
    return normStats(out);
  }
  // Add n uploads of quest qid by device dev (returns a new object).
  function addCount(stats, dev, qid, n) {
    var s = normStats(stats);
    if (!DEV_RE.test(dev) || !/^[a-z_]{2,40}$/.test(qid) || !(n > 0)) return s;
    var d = s.cnt[dev] || (s.cnt[dev] = {});
    d[qid] = (d[qid] || 0) + Math.floor(n);
    return normStats(s);
  }
  // Achievements: per category, answers summed over devices → level.
  //   [{ id, icon, en, el, n, level (0…6), next (answers to the next level, 0 at max), links[] (unlocked) }]
  function achievements(stats) {
    var s = normStats(stats), per = {};
    Object.keys(s.cnt).forEach(function (dev) {
      Object.keys(s.cnt[dev]).forEach(function (qid) {
        var q = BY_ID[qid];
        if (q && q.cat) per[q.cat] = (per[q.cat] || 0) + s.cnt[dev][qid];
      });
    });
    return CATS.map(function (c) {
      var n = per[c.id] || 0, lv = 0;
      while (lv < LEVELS.length && n >= LEVELS[lv]) lv++;
      return { id: c.id, icon: c.icon, en: c.en, el: c.el, n: n, level: lv,
        next: lv < LEVELS.length ? LEVELS[lv] - n : 0, links: c.links.slice(0, Math.min(c.links.length, Math.ceil(lv / 2))) };
    });
  }
  // Levels gained between two stats (for the "new badge" message).
  function levelUps(before, after) {
    var a = achievements(before), b = achievements(after);
    return b.filter(function (x, i) { return x.level > a[i].level; });
  }
  // Team mapping: the element goes to one member, the same on every
  // phone (FNV-1a of "n123"), so a team of `size` never answers twice.
  function teamOf(key, size) {
    var h = 0x811c9dc5;
    for (var i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h % size;
  }
  function teamKeeps(el, team) {
    if (!team || !(team.size > 1)) return true;
    return teamOf(el.t + el.id, team.size) === team.idx;
  }

  function text(q, field, lang) {
    var x = q[field];
    return (x && (x[lang] || x.en)) || "";
  }
  function optText(opt, lang) { return (lang === "el" ? opt.el : opt.en) || opt.en; }

  var api = {
    VER: VER, LIM: LIM, QUESTS: QUESTS, OVERLAY_ONLY: OVERLAY_ONLY, BY_ID: BY_ID, ID_RE: ID_RE,
    today: today, parseDay: parseDay, lastCheck: lastCheck, state: state, openQuests: openQuests,
    answerSet: answerSet, overpassQuery: overpassQuery, parseOverpass: parseOverpass,
    normAnswer: normAnswer, normalize: normalize, merge: merge, doneStats: doneStats,
    text: text, optText: optText, canon: canon,
    CATS: CATS, CAT_BY: CAT_BY, LEVELS: LEVELS, normStats: normStats, mergeStats: mergeStats, addCount: addCount,
    achievements: achievements, levelUps: levelUps, teamOf: teamOf, teamKeeps: teamKeeps
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsQuests = api;
})(typeof window !== "undefined" ? window : this);
