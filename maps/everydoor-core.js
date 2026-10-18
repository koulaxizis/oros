// ============================================================
// orOS Maps — everydoor-core.js (Every Door style tools, maps wave 9,
// v1.0.0). Pure functions, no DOM, no network: Node-tested in
// tests/maps-everydoor.test.js. Written from the OSM wiki, no Every
// Door code or text.
//
//   - Completeness: which important details a place is missing
//     (name, opening hours), so its dot can turn orange.
//   - Quick add: street furniture with one tap (bench, bin, bollard,
//     street lamp…), tags only.
//   - Entrances: the entrance types and fields (ref, addr:flats,
//     wheelchair) → tags, snapping a tap to a building's outline,
//     inserting a new node into a way's node list.
//   - The synced slice "mapsentr" (key oros-maps-entr-data):
//       { ver, items{id: item}, tombs{id: ts} }
//     item = { id, m, dev, srv, op: create|modify, lat, lon,
//              wid, a, b (create: the building way and the two nodes of
//              the edge the entrance goes on), oid (modify: node id),
//              set{k: v}, was{k: v|""}, name, err? }
//     LWW by m (equal m → larger canonical JSON); a tomb ≥ m drops the
//     item. Only the device in `dev` uploads an item.
//
// API: window.OrosMapsEveryDoor (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";
  var P = root && root.OrosMapsPoi ? root.OrosMapsPoi :
    (typeof require === "function" ? require("./poi-core.js") : null);

  var VER = "1.0.0";
  var LIM = { items: 300, tombs: 2000, name: 120, err: 200, ways: 1500, ents: 1500, pts: 400, set: 12 };
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var DEV_RE = /^[a-z0-9]{4,40}$/;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okM(v) { return isNum(v) && v >= 0 && v <= 8.64e15 && Math.floor(v) === v; }
  function okId(v) { return isNum(v) && v > 0 && v <= 1e15 && Math.floor(v) === v; }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function r7(v) { return Math.round(v * 1e7) / 1e7; }

  // ---------- texts ----------
  // ed.<quick-add id>, ed.ent.<entrance kind>, ed.wc.<wheelchair value>.
  // Other languages: the "maps" pack.
  var STR = {
    en: {
      "ed.bench": "Bench",
      "ed.waste_basket": "Litter bin",
      "ed.waste_disposal": "Dumpster",
      "ed.recycling": "Recycling bin",
      "ed.bollard": "Bollard",
      "ed.street_lamp": "Street lamp",
      "ed.post_box": "Post box",
      "ed.drinking_water": "Drinking water",
      "ed.bicycle_parking": "Bicycle parking",
      "ed.fire_hydrant": "Fire hydrant",
      "ed.defibrillator": "Defibrillator",
      "ed.vending_machine": "Vending machine",
      "ed.picnic_table": "Picnic table",
      "ed.info_board": "Information board",
      "ed.street_cabinet": "Street cabinet",
      "ed.tree": "Tree",
      "ed.ent.main": "Main entrance",
      "ed.ent.staircase": "Staircase entrance",
      "ed.ent.yes": "Other entrance",
      "ed.ent.service": "Service entrance",
      "ed.ent.garage": "Garage",
      "ed.ent.emergency": "Emergency exit",
      "ed.wc.yes": "Step-free",
      "ed.wc.limited": "Partly",
      "ed.wc.no": "No (steps)"
    },
    el: {
      "ed.bench": "Παγκάκι",
      "ed.waste_basket": "Καλάθι αχρήστων",
      "ed.waste_disposal": "Κάδος απορριμμάτων",
      "ed.recycling": "Κάδος ανακύκλωσης",
      "ed.bollard": "Κολωνάκι",
      "ed.street_lamp": "Φανοστάτης",
      "ed.post_box": "Γραμματοκιβώτιο",
      "ed.drinking_water": "Βρύση πόσιμου νερού",
      "ed.bicycle_parking": "Στάθμευση ποδηλάτων",
      "ed.fire_hydrant": "Πυροσβεστικός κρουνός",
      "ed.defibrillator": "Απινιδωτής",
      "ed.vending_machine": "Αυτόματος πωλητής",
      "ed.picnic_table": "Τραπέζι πικνίκ",
      "ed.info_board": "Πινακίδα πληροφοριών",
      "ed.street_cabinet": "Καφάο",
      "ed.tree": "Δέντρο",
      "ed.ent.main": "Κεντρική είσοδος",
      "ed.ent.staircase": "Είσοδος κλιμακοστασίου",
      "ed.ent.yes": "Άλλη είσοδος",
      "ed.ent.service": "Είσοδος υπηρεσίας",
      "ed.ent.garage": "Γκαράζ",
      "ed.ent.emergency": "Έξοδος κινδύνου",
      "ed.wc.yes": "Χωρίς σκαλιά",
      "ed.wc.limited": "Εν μέρει",
      "ed.wc.no": "Όχι (σκαλιά)"
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

  // ---------- completeness ----------
  // Places that normally have opening hours (shops, cafés, banks…).
  var OH_AMENITY = { cafe: 1, restaurant: 1, fast_food: 1, bar: 1, pub: 1, bank: 1, pharmacy: 1, post_office: 1,
    library: 1, ice_cream: 1, bureau_de_change: 1, dentist: 1, doctors: 1, clinic: 1, veterinary: 1, cinema: 1, car_wash: 1 };
  // Places that usually have no name of their own.
  var NONAME = { atm: 1, toilets: 1, parking: 1, bicycle_parking: 1, vending_machine: 1, telephone: 1, charging_station: 1, fuel: 0 };
  // → the missing keys, most important first: [] when complete.
  function missing(tags) {
    var t = tags || {}, out = [];
    var main = t.shop ? "shop" : t.amenity ? "amenity" : t.office ? "office" : t.craft ? "craft" :
      t.tourism ? "tourism" : t.leisure ? "leisure" : t.healthcare ? "healthcare" : "";
    if (!main) return out;
    if (t.disused || /^(disused|was|abandoned):/.test(Object.keys(t).join(" "))) return out;
    var noName = main === "amenity" && NONAME[t.amenity];
    if (!noName && !t.name && !t.brand && t.noname !== "yes") out.push("name");
    var wantsOH = main === "shop" ? t.shop !== "vacant" : main === "amenity" ? !!OH_AMENITY[t.amenity] :
      main === "office" || main === "craft" || main === "healthcare";
    if (wantsOH && !t.opening_hours && t["opening_hours:signed"] !== "no") out.push("opening_hours");
    return out;
  }

  // ---------- quick add ----------
  // Text: STR "ed.<id>".
  function m(id, icon, tags) { return fill({ id: id, icon: icon, tags: tags }, "ed." + id); }
  var MICRO = [
    m("bench", "🪑", { amenity: "bench" }),
    m("waste_basket", "🗑️", { amenity: "waste_basket" }),
    m("waste_disposal", "🚮", { amenity: "waste_disposal" }),
    m("recycling", "♻️", { amenity: "recycling", recycling_type: "container" }),
    m("bollard", "🚧", { barrier: "bollard" }),
    m("street_lamp", "💡", { highway: "street_lamp" }),
    m("post_box", "📮", { amenity: "post_box" }),
    m("drinking_water", "🚰", { amenity: "drinking_water" }),
    m("bicycle_parking", "🚲", { amenity: "bicycle_parking" }),
    m("fire_hydrant", "🧯", { emergency: "fire_hydrant" }),
    m("defibrillator", "❤️", { emergency: "defibrillator" }),
    m("vending_machine", "🥤", { amenity: "vending_machine" }),
    m("picnic_table", "🧺", { leisure: "picnic_table" }),
    m("info_board", "ℹ️", { tourism: "information", information: "board" }),
    m("street_cabinet", "🗄️", { man_made: "street_cabinet" }),
    m("tree", "🌳", { natural: "tree" })
  ];
  var MICRO_BY = {};
  MICRO.forEach(function (x) { MICRO_BY[x.id] = x; });
  function microTags(id) {
    var x = MICRO_BY[id];
    if (!x) return null;
    var out = {};
    Object.keys(x.tags).forEach(function (k) { out[k] = x.tags[k]; });
    return out;
  }

  // ---------- entrances ----------
  // Text: STR "ed.ent.<value>" (entrance kind) / "ed.wc.<value>" (wheelchair).
  function e(g, v) { return fill({ v: v }, "ed." + g + "." + v); }
  var ENT_TYPES = [
    e("ent", "main"),
    e("ent", "staircase"),
    e("ent", "yes"),
    e("ent", "service"),
    e("ent", "garage"),
    e("ent", "emergency")
  ];
  var WHEEL = [e("wc", "yes"), e("wc", "limited"), e("wc", "no")];
  var REF_RE = /^[0-9A-Za-zΑ-Ωα-ω]{1,4}$/;
  var FLATS_RE = /^[0-9A-Za-zΑ-Ωα-ω]{1,6}([-–;,][0-9A-Za-zΑ-Ωα-ω]{1,6}){0,40}$/;
  // form { type, ref, flats, wheelchair } → { tags } or { error: field }
  function entranceTags(form) {
    form = form || {};
    if (!ENT_TYPES.some(function (x) { return x.v === form.type; })) return { error: "type" };
    var tags = { entrance: form.type };
    var ref = String(form.ref || "").trim();
    if (ref) { if (!REF_RE.test(ref)) return { error: "ref" }; tags.ref = ref; }
    var flats = String(form.flats || "").replace(/\s+/g, "").replace(/–/g, "-");
    if (flats) { if (!FLATS_RE.test(flats)) return { error: "flats" }; tags["addr:flats"] = flats; }
    if (form.wheelchair) {
      if (!WHEEL.some(function (x) { return x.v === form.wheelchair; })) return { error: "wheelchair" };
      tags.wheelchair = form.wheelchair;
    }
    return { tags: tags };
  }
  // The form for an existing entrance's tags.
  function entranceForm(tags) {
    var t = tags || {};
    return { type: ENT_TYPES.some(function (x) { return x.v === t.entrance; }) ? t.entrance : (t.entrance ? "yes" : "main"),
      ref: t.ref || "", flats: t["addr:flats"] || "", wheelchair: t.wheelchair || "" };
  }

  // ---------- Overpass ----------
  function query(s, w, n, e2) {
    var b = [s, w, n, e2].map(function (v) { return (+v).toFixed(6); }).join(",");
    return "[out:json][timeout:25];(way[\"building\"](" + b + ");node[\"entrance\"](" + b + "););out body geom qt " + (LIM.ways + LIM.ents) + ";";
  }
  // → { ways: [{ id, nodes: [ids], geom: [[lat, lon]], tags }], ents: [{ id, lat, lon, tags }] }
  function parse(json) {
    var ways = [], ents = [];
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    els.forEach(function (x) {
      if (!x || !okId(x.id)) return;
      if (x.type === "node") {
        if (!okLat(x.lat) || !okLon(x.lon) || ents.length >= LIM.ents) return;
        var tg = P.cleanTags(x.tags || {});
        if (!tg.entrance) return;
        ents.push({ id: x.id, lat: r7(x.lat), lon: r7(x.lon), tags: tg });
      } else if (x.type === "way") {
        if (!Array.isArray(x.nodes) || !Array.isArray(x.geometry) || x.nodes.length !== x.geometry.length) return;
        if (x.nodes.length < 4 || x.nodes.length > LIM.pts || ways.length >= LIM.ways) return;
        var ok = true, geom = [], nodes = [];
        x.geometry.forEach(function (p, i) {
          if (!p || !okLat(p.lat) || !okLon(p.lon) || !okId(x.nodes[i])) { ok = false; return; }
          geom.push([r7(p.lat), r7(p.lon)]); nodes.push(x.nodes[i]);
        });
        if (!ok) return;
        ways.push({ id: x.id, nodes: nodes, geom: geom, tags: P.cleanTags(x.tags || {}) });
      }
    });
    return { ways: ways, ents: ents };
  }

  // ---------- snapping ----------
  // Local metres around a latitude (good enough for a few hundred metres).
  function toXY(p, lat0) {
    var k = Math.cos(lat0 * Math.PI / 180);
    return [p[1] * 111320 * k, p[0] * 110540];
  }
  function fromXY(xy, lat0) {
    var k = Math.cos(lat0 * Math.PI / 180);
    return [xy[1] / 110540, xy[0] / (111320 * k)];
  }
  // Nearest point on any building outline within `maxM` metres of `at`
  // ([lat, lon]): → { wid, a, b, i, lat, lon, d, vertex: node id | 0 }
  // or null. `vertexM`: closer than this to a corner → that corner.
  function snap(ways, at, maxM, vertexM) {
    var lat0 = at[0], P0 = toXY(at, lat0), best = null;
    (ways || []).forEach(function (w) {
      for (var i = 1; i < w.geom.length; i++) {
        var A = toXY(w.geom[i - 1], lat0), B = toXY(w.geom[i], lat0);
        var dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
        var f = L2 ? ((P0[0] - A[0]) * dx + (P0[1] - A[1]) * dy) / L2 : 0;
        f = Math.max(0, Math.min(1, f));
        var X = [A[0] + dx * f, A[1] + dy * f];
        var d = Math.sqrt((X[0] - P0[0]) * (X[0] - P0[0]) + (X[1] - P0[1]) * (X[1] - P0[1]));
        if (d > maxM || (best && d >= best.d)) continue;
        var segLen = Math.sqrt(L2);
        var vtx = 0;
        if (segLen * f <= (vertexM || 0)) vtx = w.nodes[i - 1];
        else if (segLen * (1 - f) <= (vertexM || 0)) vtx = w.nodes[i];
        var ll = vtx ? (vtx === w.nodes[i - 1] ? w.geom[i - 1] : w.geom[i]) : fromXY(X, lat0);
        best = { wid: w.id, a: w.nodes[i - 1], b: w.nodes[i], i: i, lat: r7(ll[0]), lon: r7(ll[1]), d: d, vertex: vtx };
      }
    });
    return best;
  }
  // Insert node `nid` between neighbours a and b (either order) of a
  // way's node list: → the new list, or null when a–b is no longer an edge.
  function insertNode(nodes, a, b, nid) {
    if (!Array.isArray(nodes)) return null;
    for (var i = 1; i < nodes.length; i++) {
      if ((nodes[i - 1] === a && nodes[i] === b) || (nodes[i - 1] === b && nodes[i] === a)) {
        var out = nodes.slice();
        out.splice(i, 0, nid);
        return out;
      }
    }
    return null;
  }

  // ---------- slice "mapsentr" ----------
  function normItem(x) {
    if (!x || typeof x !== "object") return null;
    if (typeof x.id !== "string" || !ID_RE.test(x.id) || !okM(x.m)) return null;
    if (typeof x.dev !== "string" || !DEV_RE.test(x.dev)) return null;
    if (x.op !== "create" && x.op !== "modify") return null;
    if (!okLat(x.lat) || !okLon(x.lon)) return null;
    var o = { id: x.id, m: x.m, dev: x.dev, srv: x.srv === "dev" ? "dev" : "live", op: x.op, lat: r7(x.lat), lon: r7(x.lon) };
    if (x.op === "create") {
      if (!okId(x.wid) || !okId(x.a) || !okId(x.b) || x.a === x.b) return null;
      o.wid = x.wid; o.a = x.a; o.b = x.b;
    } else {
      if (!okId(x.oid)) return null;
      o.oid = x.oid;
    }
    var set = {}, was = {}, n = 0;
    Object.keys(x.set && typeof x.set === "object" ? x.set : {}).sort().forEach(function (k) {
      var ck = P.cleanKey(k);
      if (!ck || ck !== k || n >= LIM.set || typeof x.set[k] !== "string") return;
      var v = P.cleanVal(x.set[k]);
      if (!v && x.op === "create") return;
      set[k] = v; n++;
      if (x.op === "modify") was[k] = x.was && typeof x.was[k] === "string" ? P.cleanVal(x.was[k]) : "";
    });
    if (!n || (x.op === "create" && !set.entrance)) return null;
    o.set = set;
    if (x.op === "modify") o.was = was;
    o.name = P.cleanVal(x.name, LIM.name);
    var err = P.cleanVal(x.err, LIM.err);
    if (err) o.err = err;
    return o;
  }
  function normalize(data) {
    var out = { ver: 1, items: {}, tombs: {} };
    if (!data || typeof data !== "object") return out;
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {}, tombs = {};
    Object.keys(t).forEach(function (id) { if (ID_RE.test(id) && okM(t[id])) tombs[id] = t[id]; });
    Object.keys(tombs).sort(function (a, b) { return tombs[b] - tombs[a] || (a < b ? -1 : 1); })
      .slice(0, LIM.tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    var src = data.items && typeof data.items === "object" ? data.items : {}, ok = {};
    Object.keys(src).forEach(function (k) {
      var x = normItem(src[k]);
      if (!x || x.id !== k) return;
      if (out.tombs[k] !== undefined && out.tombs[k] >= x.m) return;
      ok[k] = x;
    });
    Object.keys(ok).sort(function (a, b) { return ok[b].m - ok[a].m || (a < b ? -1 : 1); })
      .slice(0, LIM.items).sort().forEach(function (id) { out.items[id] = ok[id]; });
    return out;
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return P.canon(a) >= P.canon(b) ? a : b;
  }
  function merge(A, B) {
    var a = normalize(A), b = normalize(B), out = { items: {}, tombs: {} };
    [a, b].forEach(function (x) {
      Object.keys(x.tombs).forEach(function (id) { out.tombs[id] = Math.max(out.tombs[id] || 0, x.tombs[id]); });
      Object.keys(x.items).forEach(function (id) { out.items[id] = newer(out.items[id], x.items[id]); });
    });
    return normalize(out);
  }

  var api = {
    VER: VER, LIM: LIM, MICRO: MICRO, ENT_TYPES: ENT_TYPES, WHEEL: WHEEL,
    missing: missing, microTags: microTags, entranceTags: entranceTags, entranceForm: entranceForm,
    query: query, parse: parse, snap: snap, insertNode: insertNode,
    normItem: normItem, normalize: normalize, merge: merge
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosMapsEveryDoor = api;
})(typeof window !== "undefined" ? window : null);
