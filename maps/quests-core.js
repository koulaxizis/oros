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

  // Texts (title, q, options, none) come from STR below, by quest id and option value.
  function o(v, set) { return { v: v, set: set }; }
  function yn(key) {
    var s1 = {}, s2 = {}; s1[key] = "yes"; s2[key] = "no";
    return [o("yes", s1), o("no", s2)];
  }

  // kind: choice (one tap) · multi (tick, then Save) · hours · number · text
  var QUESTS = [
    { id: "opening_hours", icon: "🕒", kind: "hours", key: "opening_hours", recheck: 1,
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(OH_AMENITY) + '"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, OH_AMENITY)) && named(t) && t["opening_hours:signed"] !== "no"; } },
    { id: "wheelchair", icon: "♿", kind: "choice", key: "wheelchair", recheck: 4,
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(WC_AMENITY) + '"]', 'nwr["tourism"~"^(hotel|museum)$"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, WC_AMENITY) || inList(t.tourism, ["hotel", "museum"])) && named(t); },
      options: [o("yes", { wheelchair: "yes" }), o("limited", { wheelchair: "limited" }),
        o("no", { wheelchair: "no" })] },
    { id: "bench_backrest", icon: "🪑", kind: "choice", key: "backrest",
      sel: ['node["amenity"="bench"]', 'node["leisure"="picnic_table"]["bench"="yes"]'],
      applies: function (t) { return t.amenity === "bench"; },
      options: yn("backrest") },
    { id: "bus_shelter", icon: "🚏", kind: "choice", key: "shelter", recheck: 4,
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t); },
      options: yn("shelter") },
    { id: "bus_bench", icon: "🚌", kind: "choice", key: "bench", recheck: 4,
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t); },
      options: yn("bench") },
    { id: "crossing_type", icon: "🚸", kind: "choice", key: "crossing", recheck: 8,
      sel: ['node["highway"="crossing"]'],
      applies: function (t) { return t.highway === "crossing" && t.crossing !== "no" && t.crossing !== "informal"; },
      options: [o("traffic_signals", { crossing: "traffic_signals" }),
        o("marked", { crossing: "uncontrolled", "crossing:markings": "yes" }),
        o("unmarked", { crossing: "unmarked", "crossing:markings": "no" })] },
    { id: "way_lit", icon: "💡", kind: "choice", key: "lit", recheck: 8,
      sel: ['way["highway"~"' + re(LIT_HW) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, LIT_HW) && t.indoor !== "yes"; },
      options: yn("lit") },
    { id: "way_surface", icon: "🛣️", kind: "choice", key: "surface", recheck: 8,
      sel: ['way["highway"~"' + re(SURF_HW) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, SURF_HW) && t.indoor !== "yes"; },
      options: [["asphalt"], ["concrete"], ["paving_stones"],
        ["sett"], ["compacted"], ["gravel"],
        ["ground"], ["grass"], ["sand"]]
        .map(function (x) { return o(x[0], { surface: x[0] }); }) },
    { id: "toilets_fee", icon: "🚻", kind: "choice", key: "fee", recheck: 4,
      sel: ['nwr["amenity"="toilets"]'],
      applies: function (t) { return t.amenity === "toilets" && t.access !== "private" && t.access !== "customers"; },
      options: yn("fee") },
    { id: "recycling", icon: "♻️", kind: "multi",
      sel: ['nwr["amenity"="recycling"]'],
      applies: function (t) { return t.amenity === "recycling" && t.recycling_type !== "centre" && !hasPrefix(t, "recycling:"); },
      options: [["glass_bottles"], ["paper"], ["plastic"],
        ["cans"], ["clothes"], ["batteries"],
        ["small_appliances"], ["cooking_oil"]]
        .map(function (x) { var s = {}; s["recycling:" + x[0]] = "yes"; return o(x[0], s); }) },
    { id: "religion", icon: "🛐", kind: "choice", key: "religion",
      sel: ['nwr["amenity"="place_of_worship"]'],
      applies: function (t) { return t.amenity === "place_of_worship"; },
      options: [["christian"], ["muslim"], ["jewish"],
        ["buddhist"], ["hindu"], ["multifaith"]]
        .map(function (x) { return o(x[0], { religion: x[0] }); }) },
    { id: "building_levels", icon: "🏢", kind: "number", key: "building:levels", min: 1, max: 200,
      sel: ['way["building"~"' + re(LEVEL_B) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.building, LEVEL_B) && !t["building:part"]; } },
    { id: "housenumber", icon: "🔢", kind: "text", key: "addr:housenumber", maxLen: 20,
      sel: ['way["building"~"' + re(NUM_B) + '"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.building, NUM_B) && !t["addr:housename"] && t.nohousenumber !== "yes" && !t["addr:conscriptionnumber"]; },
      none: o("none", { nohousenumber: "yes" }) },
    { id: "playground_access", icon: "🛝", kind: "choice", key: "access",
      sel: ['nwr["leisure"="playground"]'],
      applies: function (t) { return t.leisure === "playground"; },
      options: [o("yes", { access: "yes" }), o("customers", { access: "customers" }),
        o("private", { access: "private" })] },
    { id: "smoking", icon: "🚬", kind: "choice", key: "smoking", recheck: 2,
      sel: ['nwr["amenity"~"' + re(SMOKE_AMENITY) + '"]'],
      applies: function (t) { return inList(t.amenity, SMOKE_AMENITY) && named(t); },
      options: [o("no", { smoking: "no" }), o("outside", { smoking: "outside" }),
        o("separated", { smoking: "separated" }), o("yes", { smoking: "yes" })] },
    { id: "bank_atm", icon: "🏧", kind: "choice", key: "atm", recheck: 4,
      sel: ['nwr["amenity"="bank"]'],
      applies: function (t) { return t.amenity === "bank"; },
      options: yn("atm") },

    // ---------- maps wave 8: 20 more ----------
    { id: "maxspeed", icon: "🚦", kind: "number", key: "maxspeed", min: 5, max: 130, cat: "streets",
      sel: ['way["highway"~"' + re(SPEED_HW) + '"][!"maxspeed"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, SPEED_HW) && !t["maxspeed:type"] && !t["source:maxspeed"]; } },
    { id: "road_name", icon: "🏷️", kind: "name", key: "name", maxLen: 80, cat: "streets",
      sel: ['way["highway"~"' + re(NAME_HW) + '"][!"name"]'],
      applies: function (t, el) { return el.t === "w" && inList(t.highway, NAME_HW) && t.noname !== "yes" && !t.ref && t.area !== "yes"; },
      none: o("none", { noname: "yes" }) },
    { id: "steps_count", icon: "🪜", kind: "number", key: "step_count", min: 1, max: 500, cat: "streets",
      sel: ['way["highway"="steps"][!"step_count"]'],
      applies: function (t, el) { return el.t === "w" && t.highway === "steps" && t.indoor !== "yes"; } },
    { id: "steps_handrail", icon: "🤚", kind: "choice", key: "handrail", recheck: 8, cat: "streets",
      sel: ['way["highway"="steps"]'],
      applies: function (t, el) { return el.t === "w" && t.highway === "steps" && !hasPrefix(t, "handrail:"); },
      options: yn("handrail") },
    { id: "tactile_paving", icon: "🦯", kind: "choice", key: "tactile_paving", recheck: 8, cat: "transit",
      sel: ['node["highway"="crossing"]'],
      applies: function (t) { return t.highway === "crossing" && t.crossing !== "no" && t.crossing !== "informal"; },
      options: [o("yes", { tactile_paving: "yes" }), o("incorrect", { tactile_paving: "incorrect" }),
        o("no", { tactile_paving: "no" })] },
    { id: "stop_name", icon: "🪧", kind: "name", key: "name", maxLen: 80, cat: "transit",
      sel: ['node["highway"="bus_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'],
      applies: function (t) { return busStop(t) && t.noname !== "yes" && t["name:signed"] !== "no"; },
      none: o("none", { "name:signed": "no" }) },
    { id: "level_crossing_barrier", icon: "🚧", kind: "choice", key: "crossing:barrier", recheck: 8, cat: "transit",
      sel: ['node["railway"="level_crossing"]'],
      applies: function (t) { return t.railway === "level_crossing"; },
      options: [o("no", { "crossing:barrier": "no" }), o("half", { "crossing:barrier": "half" }),
        o("full", { "crossing:barrier": "full" }), o("gate", { "crossing:barrier": "gate" })] },
    { id: "parking_fee", icon: "🅿️", kind: "choice", key: "fee", recheck: 4, cat: "parking",
      sel: ['nwr["amenity"="parking"]'],
      applies: function (t) { return t.amenity === "parking" && pub(t) && t.access !== "customers"; },
      options: yn("fee") },
    { id: "parking_type", icon: "🚗", kind: "choice", key: "parking", cat: "parking",
      sel: ['nwr["amenity"="parking"][!"parking"]'],
      applies: function (t) { return t.amenity === "parking"; },
      options: [o("surface", { parking: "surface" }), o("multi-storey", { parking: "multi-storey" }),
        o("underground", { parking: "underground" }), o("street_side", { parking: "street_side" })] },
    { id: "bike_parking_capacity", icon: "🚲", kind: "number", key: "capacity", min: 1, max: 1000, cat: "parking",
      sel: ['nwr["amenity"="bicycle_parking"][!"capacity"]'],
      applies: function (t) { return t.amenity === "bicycle_parking"; } },
    { id: "bike_parking_covered", icon: "☂️", kind: "choice", key: "covered", recheck: 8, cat: "parking",
      sel: ['nwr["amenity"="bicycle_parking"]'],
      applies: function (t) { return t.amenity === "bicycle_parking" && t.bicycle_parking !== "building"; },
      options: yn("covered") },
    { id: "diet_vegetarian", icon: "🥗", kind: "choice", key: "diet:vegetarian", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(DIET_AMENITY) + '"]'],
      applies: function (t) { return inList(t.amenity, DIET_AMENITY) && named(t) && t["diet:vegan"] !== "only"; },
      options: [o("only", { "diet:vegetarian": "only" }), o("yes", { "diet:vegetarian": "yes" }),
        o("limited", { "diet:vegetarian": "limited" }), o("no", { "diet:vegetarian": "no" })] },
    { id: "diet_vegan", icon: "🌱", kind: "choice", key: "diet:vegan", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(DIET_AMENITY) + '"]["diet:vegetarian"~"^(yes|only|limited)$"]'],
      applies: function (t) { return inList(t.amenity, DIET_AMENITY) && named(t) && inList(t["diet:vegetarian"], ["yes", "only", "limited"]); },
      options: [o("only", { "diet:vegan": "only" }), o("yes", { "diet:vegan": "yes" }),
        o("limited", { "diet:vegan": "limited" }), o("no", { "diet:vegan": "no" })] },
    { id: "payment", icon: "💳", kind: "multi", cat: "places",
      sel: ['nwr["shop"]', 'nwr["amenity"~"' + re(PAY_AMENITY) + '"]'],
      applies: function (t) { return (shopOpen(t) || inList(t.amenity, PAY_AMENITY)) && named(t) && !hasPrefix(t, "payment:"); },
      options: [["cash"], ["debit_cards"], ["credit_cards"],
        ["contactless"]]
        .map(function (x) { var st = {}; st["payment:" + x[0]] = "yes"; return o(x[0], st); }) },
    { id: "internet_access", icon: "📶", kind: "choice", key: "internet_access", recheck: 2, cat: "places",
      sel: ['nwr["amenity"~"' + re(WIFI_AMENITY) + '"]', 'nwr["tourism"="hotel"]'],
      applies: function (t) { return (inList(t.amenity, WIFI_AMENITY) || t.tourism === "hotel") && named(t); },
      options: [o("wlan", { internet_access: "wlan" }), o("no", { internet_access: "no" })] },
    { id: "toilets_wheelchair", icon: "🚾", kind: "choice", key: "wheelchair", recheck: 4, cat: "things",
      sel: ['nwr["amenity"="toilets"]'],
      applies: function (t) { return t.amenity === "toilets" && pub(t); },
      options: [o("yes", { wheelchair: "yes" }), o("limited", { wheelchair: "limited" }), o("no", { wheelchair: "no" })] },
    { id: "aed_indoor", icon: "❤️", kind: "choice", key: "indoor", cat: "things",
      sel: ['node["emergency"="defibrillator"][!"indoor"]'],
      applies: function (t) { return t.emergency === "defibrillator"; },
      options: yn("indoor") },
    { id: "fire_hydrant_type", icon: "🧯", kind: "choice", key: "fire_hydrant:type", cat: "things",
      sel: ['node["emergency"="fire_hydrant"][!"fire_hydrant:type"]'],
      applies: function (t) { return t.emergency === "fire_hydrant"; },
      options: [o("pillar", { "fire_hydrant:type": "pillar" }),
        o("underground", { "fire_hydrant:type": "underground" }),
        o("wall", { "fire_hydrant:type": "wall" })] },
    { id: "postbox_times", icon: "📮", kind: "hours", key: "collection_times", recheck: 2, cat: "things",
      sel: ['node["amenity"="post_box"]'],
      applies: function (t) { return t.amenity === "post_box" && t["collection_times:signed"] !== "no"; } },
    { id: "building_type", icon: "🏠", kind: "choice", key: "building", blank: "yes", cat: "buildings",
      sel: ['way["building"="yes"]'],
      applies: function (t, el) { return el.t === "w" && t.building === "yes" && !t["building:part"] && !t.amenity && !t.shop; },
      options: [["house"], ["apartments"], ["commercial"],
        ["industrial"], ["garage"], ["shed"],
        ["school"], ["church"], ["ruins"]]
        .map(function (x) { return o(x[0], { building: x[0] }); }) }
  ];
  var OLD_CAT = { opening_hours: "places", wheelchair: "places", smoking: "places", bank_atm: "places", religion: "places",
    way_lit: "streets", way_surface: "streets", bus_shelter: "transit", bus_bench: "transit", crossing_type: "transit",
    building_levels: "buildings", housenumber: "buildings", bench_backrest: "things", toilets_fee: "things",
    recycling: "things", playground_access: "things" };
  // Answers made from an overlay (overlays-core.js, maps wave 8B) that no
  // pin asks: valid in the slice and counted, never in QUESTS.
  var OVERLAY_ONLY = [
    { id: "sidewalk", icon: "🚶", kind: "overlay", key: "sidewalk", cat: "streets", sel: [],
      applies: function () { return false; } }
  ];
  // ---------- texts ----------
  // UI strings of the quests: q.<quest>.title / .q / .none, q.<quest>.<option>
  // (else q.yes / q.no) and q.cat.<category>. Other languages: the "maps" pack.
  var STR = {
    en: {
      "q.opening_hours.title": "Opening hours",
      "q.opening_hours.q": "When is {name} open?",
      "q.wheelchair.title": "Wheelchair access",
      "q.wheelchair.q": "Can you get into {name} in a wheelchair?",
      "q.wheelchair.yes": "Yes, fully",
      "q.wheelchair.limited": "Partly (a small step, help needed)",
      "q.no": "No",
      "q.bench_backrest.title": "Bench backrest",
      "q.bench_backrest.q": "Does this bench have a backrest?",
      "q.yes": "Yes",
      "q.bus_shelter.title": "Bus stop shelter",
      "q.bus_shelter.q": "Does this bus stop have a shelter?",
      "q.bus_bench.title": "Bench at the bus stop",
      "q.bus_bench.q": "Is there a bench at this bus stop?",
      "q.crossing_type.title": "Crossing type",
      "q.crossing_type.q": "What kind of crossing is this?",
      "q.crossing_type.traffic_signals": "With traffic lights",
      "q.crossing_type.marked": "Marked (zebra), no lights",
      "q.crossing_type.unmarked": "No markings",
      "q.way_lit.title": "Street lights",
      "q.way_lit.q": "Is {name} lit at night?",
      "q.way_lit.yes": "Yes, it has street lights",
      "q.way_surface.title": "Surface",
      "q.way_surface.q": "What is the surface of {name}?",
      "q.way_surface.asphalt": "Asphalt",
      "q.way_surface.concrete": "Concrete",
      "q.way_surface.paving_stones": "Paving stones",
      "q.way_surface.sett": "Cobblestones (sett)",
      "q.way_surface.compacted": "Compacted gravel",
      "q.way_surface.gravel": "Loose gravel",
      "q.way_surface.ground": "Bare ground",
      "q.way_surface.grass": "Grass",
      "q.way_surface.sand": "Sand",
      "q.toilets_fee.title": "Toilets fee",
      "q.toilets_fee.q": "Do these toilets cost money?",
      "q.toilets_fee.yes": "Yes, you pay",
      "q.toilets_fee.no": "No, free",
      "q.recycling.title": "Recycling",
      "q.recycling.q": "What can you recycle here?",
      "q.recycling.glass_bottles": "Glass bottles",
      "q.recycling.paper": "Paper",
      "q.recycling.plastic": "Plastic",
      "q.recycling.cans": "Cans",
      "q.recycling.clothes": "Clothes",
      "q.recycling.batteries": "Batteries",
      "q.recycling.small_appliances": "Small appliances",
      "q.recycling.cooking_oil": "Cooking oil",
      "q.religion.title": "Religion",
      "q.religion.q": "Which religion is {name} for?",
      "q.religion.christian": "Christian",
      "q.religion.muslim": "Muslim",
      "q.religion.jewish": "Jewish",
      "q.religion.buddhist": "Buddhist",
      "q.religion.hindu": "Hindu",
      "q.religion.multifaith": "For several religions",
      "q.building_levels.title": "Building floors",
      "q.building_levels.q": "How many floors does this building have above the ground (ground floor included, roof not)?",
      "q.housenumber.title": "House number",
      "q.housenumber.q": "What is the house number of this building?",
      "q.housenumber.none": "It has no number",
      "q.playground_access.title": "Playground access",
      "q.playground_access.q": "Who can use this playground?",
      "q.playground_access.yes": "Everyone",
      "q.playground_access.customers": "Only customers",
      "q.playground_access.private": "Private (residents only)",
      "q.smoking.title": "Smoking",
      "q.smoking.q": "Is smoking allowed at {name}?",
      "q.smoking.outside": "Only outside",
      "q.smoking.separated": "In a separate room",
      "q.smoking.yes": "Yes, inside too",
      "q.bank_atm.title": "ATM at the bank",
      "q.bank_atm.q": "Does {name} have an ATM?",
      "q.maxspeed.title": "Speed limit",
      "q.maxspeed.q": "What speed limit is signed on {name} (km/h)? Answer only if you see a sign.",
      "q.road_name.title": "Street name",
      "q.road_name.q": "What is the name of this street, as on the sign?",
      "q.road_name.none": "It has no name",
      "q.steps_count.title": "Number of steps",
      "q.steps_count.q": "How many steps are there?",
      "q.steps_handrail.title": "Handrail",
      "q.steps_handrail.q": "Do these steps have a handrail?",
      "q.tactile_paving.title": "Tactile paving at the crossing",
      "q.tactile_paving.q": "Is there tactile paving (raised bumps) on both sides of this crossing?",
      "q.tactile_paving.incorrect": "Only on one side, or wrongly laid",
      "q.stop_name.title": "Stop name",
      "q.stop_name.q": "What is the name of this stop, as on its sign?",
      "q.stop_name.none": "No name on the sign",
      "q.level_crossing_barrier.title": "Level crossing barrier",
      "q.level_crossing_barrier.q": "What barrier does this railway crossing have?",
      "q.level_crossing_barrier.no": "None",
      "q.level_crossing_barrier.half": "Half barriers",
      "q.level_crossing_barrier.full": "Full barriers",
      "q.level_crossing_barrier.gate": "Gates",
      "q.parking_fee.title": "Parking fee",
      "q.parking_fee.q": "Do you have to pay to park here?",
      "q.parking_fee.yes": "Yes, you pay",
      "q.parking_fee.no": "No, free",
      "q.parking_type.title": "Kind of car park",
      "q.parking_type.q": "What kind of car park is this?",
      "q.parking_type.surface": "Open-air lot",
      "q.parking_type.multi-storey": "Multi-storey",
      "q.parking_type.underground": "Underground",
      "q.parking_type.street_side": "Bays beside the street",
      "q.bike_parking_capacity.title": "Bicycle parking spaces",
      "q.bike_parking_capacity.q": "How many bicycles can be parked here?",
      "q.bike_parking_covered.title": "Covered bicycle parking",
      "q.bike_parking_covered.q": "Is this bicycle parking covered?",
      "q.diet_vegetarian.title": "Vegetarian food",
      "q.diet_vegetarian.q": "Does {name} serve vegetarian dishes?",
      "q.diet_vegetarian.only": "Only vegetarian",
      "q.diet_vegetarian.yes": "Yes, several",
      "q.diet_vegetarian.limited": "A few",
      "q.diet_vegan.title": "Vegan food",
      "q.diet_vegan.q": "Does {name} serve vegan dishes?",
      "q.diet_vegan.only": "Only vegan",
      "q.diet_vegan.yes": "Yes, several",
      "q.diet_vegan.limited": "A few",
      "q.payment.title": "Ways to pay",
      "q.payment.q": "How can you pay at {name}?",
      "q.payment.cash": "Cash",
      "q.payment.debit_cards": "Debit cards",
      "q.payment.credit_cards": "Credit cards",
      "q.payment.contactless": "Contactless (tap)",
      "q.internet_access.title": "Wi-Fi",
      "q.internet_access.q": "Does {name} offer Wi-Fi to customers?",
      "q.internet_access.wlan": "Yes",
      "q.toilets_wheelchair.title": "Wheelchair toilet",
      "q.toilets_wheelchair.q": "Can these toilets be used from a wheelchair?",
      "q.toilets_wheelchair.limited": "Partly",
      "q.aed_indoor.title": "Defibrillator",
      "q.aed_indoor.q": "Is this defibrillator (AED) inside a building?",
      "q.aed_indoor.yes": "Yes, inside",
      "q.aed_indoor.no": "No, outside",
      "q.fire_hydrant_type.title": "Fire hydrant",
      "q.fire_hydrant_type.q": "What kind of fire hydrant is this?",
      "q.fire_hydrant_type.pillar": "Pillar above the ground",
      "q.fire_hydrant_type.underground": "Underground (a lid in the street)",
      "q.fire_hydrant_type.wall": "On a wall",
      "q.postbox_times.title": "Postbox collection times",
      "q.postbox_times.q": "When is this postbox emptied?",
      "q.building_type.title": "Kind of building",
      "q.building_type.q": "What kind of building is this?",
      "q.building_type.house": "House",
      "q.building_type.apartments": "Apartment block",
      "q.building_type.commercial": "Offices or shops",
      "q.building_type.industrial": "Industrial",
      "q.building_type.garage": "Garage",
      "q.building_type.shed": "Shed",
      "q.building_type.school": "School",
      "q.building_type.church": "Church",
      "q.building_type.ruins": "Ruins",
      "q.sidewalk.title": "Sidewalks",
      "q.cat.places": "Shops and cafés",
      "q.cat.streets": "Streets and paths",
      "q.cat.transit": "Stops and crossings",
      "q.cat.parking": "Parking",
      "q.cat.buildings": "Buildings and addresses",
      "q.cat.things": "Street furniture"
    },
    el: {
      "q.opening_hours.title": "Ωράριο",
      "q.opening_hours.q": "Πότε είναι ανοιχτό το {name};",
      "q.wheelchair.title": "Πρόσβαση με αμαξίδιο",
      "q.wheelchair.q": "Μπαίνει κανείς στο {name} με αμαξίδιο;",
      "q.wheelchair.yes": "Ναι, πλήρως",
      "q.wheelchair.limited": "Εν μέρει (ένα σκαλάκι, χρειάζεται βοήθεια)",
      "q.no": "Όχι",
      "q.bench_backrest.title": "Πλάτη στο παγκάκι",
      "q.bench_backrest.q": "Έχει πλάτη αυτό το παγκάκι;",
      "q.yes": "Ναι",
      "q.bus_shelter.title": "Στέγαστρο στάσης",
      "q.bus_shelter.q": "Έχει στέγαστρο αυτή η στάση;",
      "q.bus_bench.title": "Παγκάκι στη στάση",
      "q.bus_bench.q": "Υπάρχει παγκάκι σε αυτή τη στάση;",
      "q.crossing_type.title": "Είδος διάβασης",
      "q.crossing_type.q": "Τι διάβαση είναι αυτή;",
      "q.crossing_type.traffic_signals": "Με φανάρι",
      "q.crossing_type.marked": "Διαγράμμιση (ζέβρα), χωρίς φανάρι",
      "q.crossing_type.unmarked": "Χωρίς διαγράμμιση",
      "q.way_lit.title": "Φωτισμός δρόμου",
      "q.way_lit.q": "Φωτίζεται τη νύχτα: {name};",
      "q.way_lit.yes": "Ναι, έχει φώτα",
      "q.way_surface.title": "Επιφάνεια",
      "q.way_surface.q": "Τι επιφάνεια έχει: {name};",
      "q.way_surface.asphalt": "Άσφαλτος",
      "q.way_surface.concrete": "Μπετόν",
      "q.way_surface.paving_stones": "Πλάκες / κυβόλιθοι",
      "q.way_surface.sett": "Καλντερίμι",
      "q.way_surface.compacted": "Πατημένο χαλίκι",
      "q.way_surface.gravel": "Χαλίκι",
      "q.way_surface.ground": "Χώμα",
      "q.way_surface.grass": "Χορτάρι",
      "q.way_surface.sand": "Άμμος",
      "q.toilets_fee.title": "Χρέωση τουαλέτας",
      "q.toilets_fee.q": "Έχουν χρέωση αυτές οι τουαλέτες;",
      "q.toilets_fee.yes": "Ναι, πληρώνεις",
      "q.toilets_fee.no": "Όχι, δωρεάν",
      "q.recycling.title": "Ανακύκλωση",
      "q.recycling.q": "Τι ανακυκλώνεται εδώ;",
      "q.recycling.glass_bottles": "Γυάλινα μπουκάλια",
      "q.recycling.paper": "Χαρτί",
      "q.recycling.plastic": "Πλαστικό",
      "q.recycling.cans": "Κουτάκια",
      "q.recycling.clothes": "Ρούχα",
      "q.recycling.batteries": "Μπαταρίες",
      "q.recycling.small_appliances": "Μικρές συσκευές",
      "q.recycling.cooking_oil": "Μαγειρικό λάδι",
      "q.religion.title": "Θρήσκευμα",
      "q.religion.q": "Σε ποιο θρήσκευμα ανήκει: {name};",
      "q.religion.christian": "Χριστιανικό",
      "q.religion.muslim": "Μουσουλμανικό",
      "q.religion.jewish": "Εβραϊκό",
      "q.religion.buddhist": "Βουδιστικό",
      "q.religion.hindu": "Ινδουιστικό",
      "q.religion.multifaith": "Για πολλά θρησκεύματα",
      "q.building_levels.title": "Όροφοι κτιρίου",
      "q.building_levels.q": "Πόσους ορόφους έχει πάνω από το έδαφος (μαζί με το ισόγειο, χωρίς τη σοφίτα);",
      "q.housenumber.title": "Αριθμός",
      "q.housenumber.q": "Τι αριθμό έχει αυτό το κτίριο;",
      "q.housenumber.none": "Δεν έχει αριθμό",
      "q.playground_access.title": "Πρόσβαση στην παιδική χαρά",
      "q.playground_access.q": "Ποιος μπορεί να χρησιμοποιήσει αυτή την παιδική χαρά;",
      "q.playground_access.yes": "Όλοι",
      "q.playground_access.customers": "Μόνο πελάτες",
      "q.playground_access.private": "Ιδιωτική (μόνο κάτοικοι)",
      "q.smoking.title": "Κάπνισμα",
      "q.smoking.q": "Επιτρέπεται το κάπνισμα στο {name};",
      "q.smoking.outside": "Μόνο έξω",
      "q.smoking.separated": "Σε χωριστό χώρο",
      "q.smoking.yes": "Ναι, και μέσα",
      "q.bank_atm.title": "ΑΤΜ στην τράπεζα",
      "q.bank_atm.q": "Έχει ΑΤΜ: {name};",
      "q.maxspeed.title": "Όριο ταχύτητας",
      "q.maxspeed.q": "Τι όριο ταχύτητας γράφει η πινακίδα στο {name} (χλμ./ώρα); Απάντησε μόνο αν βλέπεις πινακίδα.",
      "q.road_name.title": "Όνομα δρόμου",
      "q.road_name.q": "Πώς λέγεται αυτός ο δρόμος, όπως γράφει η πινακίδα;",
      "q.road_name.none": "Δεν έχει όνομα",
      "q.steps_count.title": "Πόσα σκαλιά",
      "q.steps_count.q": "Πόσα σκαλιά έχει;",
      "q.steps_handrail.title": "Κουπαστή",
      "q.steps_handrail.q": "Έχουν κουπαστή αυτά τα σκαλιά;",
      "q.tactile_paving.title": "Όδευση τυφλών στη διάβαση",
      "q.tactile_paving.q": "Υπάρχει όδευση τυφλών (ανάγλυφες πλάκες) και στις δύο πλευρές της διάβασης;",
      "q.tactile_paving.incorrect": "Μόνο στη μία πλευρά ή λάθος τοποθετημένη",
      "q.stop_name.title": "Όνομα στάσης",
      "q.stop_name.q": "Πώς λέγεται αυτή η στάση, όπως γράφει η πινακίδα;",
      "q.stop_name.none": "Η πινακίδα δεν έχει όνομα",
      "q.level_crossing_barrier.title": "Μπάρα στην ισόπεδη διάβαση",
      "q.level_crossing_barrier.q": "Τι μπάρα έχει αυτή η σιδηροδρομική διάβαση;",
      "q.level_crossing_barrier.no": "Καμία",
      "q.level_crossing_barrier.half": "Μισές μπάρες",
      "q.level_crossing_barrier.full": "Μπάρες σε όλο το πλάτος",
      "q.level_crossing_barrier.gate": "Πύλες",
      "q.parking_fee.title": "Χρέωση στάθμευσης",
      "q.parking_fee.q": "Πληρώνεις για να παρκάρεις εδώ;",
      "q.parking_fee.yes": "Ναι, πληρώνεις",
      "q.parking_fee.no": "Όχι, δωρεάν",
      "q.parking_type.title": "Είδος πάρκινγκ",
      "q.parking_type.q": "Τι πάρκινγκ είναι αυτό;",
      "q.parking_type.surface": "Υπαίθριο",
      "q.parking_type.multi-storey": "Πολυώροφο",
      "q.parking_type.underground": "Υπόγειο",
      "q.parking_type.street_side": "Θέσεις στην άκρη του δρόμου",
      "q.bike_parking_capacity.title": "Θέσεις ποδηλάτων",
      "q.bike_parking_capacity.q": "Πόσα ποδήλατα χωράνε εδώ;",
      "q.bike_parking_covered.title": "Στέγαστρο ποδηλάτων",
      "q.bike_parking_covered.q": "Έχει στέγαστρο αυτή η θέση ποδηλάτων;",
      "q.diet_vegetarian.title": "Χορτοφαγικό φαγητό",
      "q.diet_vegetarian.q": "Σερβίρει χορτοφαγικά πιάτα το {name};",
      "q.diet_vegetarian.only": "Μόνο χορτοφαγικά",
      "q.diet_vegetarian.yes": "Ναι, αρκετά",
      "q.diet_vegetarian.limited": "Λίγα",
      "q.diet_vegan.title": "Vegan φαγητό",
      "q.diet_vegan.q": "Σερβίρει vegan πιάτα το {name};",
      "q.diet_vegan.only": "Μόνο vegan",
      "q.diet_vegan.yes": "Ναι, αρκετά",
      "q.diet_vegan.limited": "Λίγα",
      "q.payment.title": "Τρόποι πληρωμής",
      "q.payment.q": "Πώς πληρώνεις στο {name};",
      "q.payment.cash": "Μετρητά",
      "q.payment.debit_cards": "Χρεωστική κάρτα",
      "q.payment.credit_cards": "Πιστωτική κάρτα",
      "q.payment.contactless": "Ανέπαφα",
      "q.internet_access.title": "Wi-Fi",
      "q.internet_access.q": "Έχει Wi-Fi για τους πελάτες το {name};",
      "q.internet_access.wlan": "Ναι",
      "q.toilets_wheelchair.title": "Τουαλέτα για αμαξίδιο",
      "q.toilets_wheelchair.q": "Μπορεί να τις χρησιμοποιήσει κάποιος με αμαξίδιο;",
      "q.toilets_wheelchair.limited": "Εν μέρει",
      "q.aed_indoor.title": "Απινιδωτής",
      "q.aed_indoor.q": "Αυτός ο απινιδωτής είναι μέσα σε κτίριο;",
      "q.aed_indoor.yes": "Ναι, μέσα",
      "q.aed_indoor.no": "Όχι, έξω",
      "q.fire_hydrant_type.title": "Πυροσβεστικός κρουνός",
      "q.fire_hydrant_type.q": "Τι κρουνός είναι αυτός;",
      "q.fire_hydrant_type.pillar": "Κολόνα πάνω από το έδαφος",
      "q.fire_hydrant_type.underground": "Υπόγειος (καπάκι στον δρόμο)",
      "q.fire_hydrant_type.wall": "Σε τοίχο",
      "q.postbox_times.title": "Ώρες αποκομιδής",
      "q.postbox_times.q": "Πότε αδειάζει αυτό το γραμματοκιβώτιο;",
      "q.building_type.title": "Είδος κτιρίου",
      "q.building_type.q": "Τι κτίριο είναι αυτό;",
      "q.building_type.house": "Μονοκατοικία",
      "q.building_type.apartments": "Πολυκατοικία",
      "q.building_type.commercial": "Γραφεία ή καταστήματα",
      "q.building_type.industrial": "Βιομηχανικό",
      "q.building_type.garage": "Γκαράζ",
      "q.building_type.shed": "Αποθήκη",
      "q.building_type.school": "Σχολείο",
      "q.building_type.church": "Εκκλησία",
      "q.building_type.ruins": "Ερείπιο",
      "q.sidewalk.title": "Πεζοδρόμια",
      "q.cat.places": "Μαγαζιά και καφέ",
      "q.cat.streets": "Δρόμοι και μονοπάτια",
      "q.cat.transit": "Στάσεις και διαβάσεις",
      "q.cat.parking": "Στάθμευση",
      "q.cat.buildings": "Κτίρια και διευθύνσεις",
      "q.cat.things": "Αστικός εξοπλισμός"
    }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(STR, "maps", window.orosI18n.lang());
  // { en, el, <pack language>… } of one key (English where a language lacks it)
  function L(k) {
    var r = {};
    Object.keys(STR).forEach(function (c) { var v = STR[c] && STR[c][k]; r[c] = v !== undefined ? v : STR.en[k]; });
    return r;
  }
  function fill(x, k) { var r = L(k); Object.keys(r).forEach(function (c) { x[c] = r[c]; }); return x; }
  function optKey(q, v) { var k = "q." + q.id + "." + v; return STR.en[k] !== undefined ? k : "q." + v; }
  QUESTS.concat(OVERLAY_ONLY).forEach(function (q) {
    q.title = L("q." + q.id + ".title");
    if (STR.en["q." + q.id + ".q"] !== undefined) q.q = L("q." + q.id + ".q");
    (q.options || []).forEach(function (op) { fill(op, optKey(q, op.v)); });
    if (q.none) fill(q.none, "q." + q.id + ".none");
  });
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
        if (!v || !/^[0-9A-Za-z\u0370-\u03FF\u1F00-\u1FFF/\-\s,;]+$/.test(v) || !/\d/.test(v)) return null;
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
    { id: "places", icon: "🏪",
      links: ["https://wiki.openstreetmap.org/wiki/Key:opening_hours", "https://wiki.openstreetmap.org/wiki/Key:diet", "https://wiki.openstreetmap.org/wiki/Key:payment"] },
    { id: "streets", icon: "🛣️",
      links: ["https://wiki.openstreetmap.org/wiki/Key:surface", "https://wiki.openstreetmap.org/wiki/Key:maxspeed", "https://wiki.openstreetmap.org/wiki/Key:lit"] },
    { id: "transit", icon: "🚏",
      links: ["https://wiki.openstreetmap.org/wiki/Public_transport", "https://wiki.openstreetmap.org/wiki/Key:tactile_paving", "https://transitous.org/"] },
    { id: "parking", icon: "🅿️",
      links: ["https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking", "https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dbicycle_parking"] },
    { id: "buildings", icon: "🏢",
      links: ["https://wiki.openstreetmap.org/wiki/Addresses", "https://wiki.openstreetmap.org/wiki/Key:building"] },
    { id: "things", icon: "🪑",
      links: ["https://wiki.openstreetmap.org/wiki/Street_furniture", "https://openaedmap.org/"] }
  ];
  var CAT_BY = {};
  CATS.forEach(function (c) { fill(c, "q.cat." + c.id); CAT_BY[c.id] = c; });
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
      return fill({ id: c.id, icon: c.icon, n: n, level: lv,
        next: lv < LEVELS.length ? LEVELS[lv] - n : 0, links: c.links.slice(0, Math.min(c.links.length, Math.ceil(lv / 2))) }, "q.cat." + c.id);
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
  function optText(opt, lang) { return (opt && (opt[lang] || opt.en)) || ""; }

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
