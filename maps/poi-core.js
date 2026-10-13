// ============================================================
// orOS Maps — poi-core.js (place editing core, OSM upgrade wave 2,
// v1.0.0). Pure functions, no DOM, no network: Node-tested in
// tests/maps-poi.test.js.
//
//   - Presets (maps/presets-data.js, from id-tagging-schema, ISC):
//     index, best match for a tag set, search in EN / EL.
//   - Tags: apply a change set, diff two tag sets, rebase a change on
//     the server's current tags (keys the user did not touch follow
//     the server; a key both sides changed keeps the server value and
//     is reported as a conflict, nothing is overwritten blindly).
//   - OSM API 0.6 XML: changeset and osmChange documents (escaped),
//     diffResult parsing.
//   - Overpass: the query for the places of a box, strict parsing.
//   - Simple opening_hours: parse / format the common "Mo-Fr 09:00-17:00;
//     Sa 10:00-14:00" shape; anything richer returns null and the UI
//     keeps the raw text.
//   - The synced slice "mapsedits" (key oros-maps-edits-data):
//       { ver, edits{id: edit}, tombs{id: ts} }
//     edit = { id, m, dev, srv, op: create|modify|delete, t: n|w|r,
//              oid, lat?, lon?, set{k: v|""}, was{k: v|""}, name, pre, err? }
//     LWW by m (equal m → larger canonical JSON); a tomb ≥ m drops
//     the edit. Only the device in `dev` uploads an edit, so two
//     devices never upload the same change.
//
// API: window.OrosMapsPoi (module.exports in Node).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";
  var LIM = { key: 255, val: 255, set: 120, edits: 500, tombs: 2000, name: 120, err: 200, places: 600 };
  var OPS = { create: 1, modify: 1, "delete": 1 };
  var TYPES = { n: "node", w: "way", r: "relation" };
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var DEV_RE = /^[a-z0-9]{4,40}$/;
  var KEY_RE = /^[^\u0000-\u001f\u007f=]{1,255}$/;
  var POI_KEYS = ["amenity", "shop", "tourism", "leisure", "office", "craft", "healthcare", "club"];
  // Street furniture and the like: editable through quests later, not
  // listed as places (they would bury the shops and cafés).
  var MICRO = {
    amenity: { bench: 1, waste_basket: 1, parking_space: 1, parking_entrance: 1, bicycle_parking: 1,
      vending_machine: 1, waste_disposal: 1, recycling: 1, drinking_water: 1, post_box: 1,
      telephone: 1, clock: 1, shelter: 1, hunting_stand: 1, grit_bin: 1, letter_box: 1, parking: 1,
      motorcycle_parking: 1, loading_dock: 1, bbq: 1, lounger: 1, water_point: 1, watering_place: 1 },
    leisure: { pitch: 1, playground: 1, park: 1, garden: 1, picnic_table: 1, track: 1, swimming_pool: 1,
      common: 1, nature_reserve: 1, slipway: 1, firepit: 1, outdoor_seating: 1, dog_park: 1 },
    tourism: { information: 1, viewpoint: 1, picnic_site: 1, artwork: 1, camp_pitch: 1 }
  };

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function okM(v) { return isNum(v) && v >= 0 && v <= 8.64e15 && Math.floor(v) === v; }
  function okLat(v) { return isNum(v) && v >= -90 && v <= 90; }
  function okLon(v) { return isNum(v) && v >= -180 && v <= 180; }
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function cleanVal(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    return s.length > (max || LIM.val) ? s.slice(0, max || LIM.val) : s;
  }
  function cleanKey(k) {
    k = cleanVal(k, LIM.key);
    return KEY_RE.test(k) ? k : "";
  }
  // Accent / case folding for search ("Καφέ" == "καφε").
  function fold(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }

  // ---------- presets ----------
  function presetIndex(data) {
    var idx = { byKV: {}, byK: {}, list: [], fields: (data && data.fields) || {}, more: (data && data.more) || [] };
    ((data && data.presets) || []).forEach(function (p) {
      idx.list.push(p);
      var keys = Object.keys(p.t || {});
      keys.forEach(function (k) {
        var v = p.t[k];
        if (v === "*") (idx.byK[k] = idx.byK[k] || []).push(p);
        else (idx.byKV[k + "=" + v] = idx.byKV[k + "=" + v] || []).push(p);
      });
    });
    return idx;
  }

  // Best preset: every preset tag present (value "*" = any value);
  // more matched tags wins, then matchScore, then id (stable).
  function matchPreset(idx, tags) {
    tags = tags || {};
    var cands = {};
    Object.keys(tags).forEach(function (k) {
      (idx.byKV[k + "=" + tags[k]] || []).concat(idx.byK[k] || []).forEach(function (p) { cands[p.id] = p; });
    });
    var best = null, bestScore = -1;
    Object.keys(cands).sort().forEach(function (id) {
      var p = cands[id], ok = true, n = 0;
      Object.keys(p.t).forEach(function (k) {
        if (tags[k] === undefined || (p.t[k] !== "*" && tags[k] !== p.t[k])) ok = false;
        else n += p.t[k] === "*" ? 0.5 : 1;
      });
      if (!ok) return;
      var score = n * 10 + (isNum(p.ms) ? p.ms : 1);
      if (score > bestScore) { best = p; bestScore = score; }
    });
    return best;
  }

  function presetName(p, lang) {
    if (!p) return "";
    return (p.n && (p.n[lang] || p.n.en)) || p.id;
  }

  function searchPresets(idx, q, lang, max) {
    q = fold(q).trim();
    if (!q) return [];
    var out = [];
    idx.list.forEach(function (p) {
      var names = [fold(p.n && p.n[lang]), fold(p.n && p.n.en)];
      var terms = ((p.s && p.s[lang]) || []).concat((p.s && p.s.en) || []).map(fold);
      var score = 0;
      names.forEach(function (n) {
        if (!n) return;
        if (n === q) score = Math.max(score, 100);
        else if (n.indexOf(q) === 0) score = Math.max(score, 80);
        else if (n.indexOf(" " + q) >= 0) score = Math.max(score, 60);
        else if (n.indexOf(q) >= 0) score = Math.max(score, 40);
      });
      terms.forEach(function (t) {
        if (t === q) score = Math.max(score, 50);
        else if (t.indexOf(q) === 0) score = Math.max(score, 30);
      });
      if (score) out.push({ p: p, s: score + (p.id.split("/").length === 2 ? 1 : 0) });
    });
    out.sort(function (a, b) {
      return b.s - a.s || (presetName(a.p, lang) < presetName(b.p, lang) ? -1 : 1);
    });
    return out.slice(0, max || 30).map(function (x) { return x.p; });
  }

  // Field ids for an element: preset fields, then the "more" fields
  // whose keys already have a value.
  function fieldsFor(idx, preset, tags) {
    var list = ((preset && preset.f) || []).slice();
    if (list.indexOf("name") < 0) list.unshift("name");
    idx.more.forEach(function (f) {
      if (list.indexOf(f) >= 0) return;
      var def = idx.fields[f];
      if (!def) return;
      var keys = def.ks || (def.k ? [def.k] : []);
      if (keys.some(function (k) { return tags && tags[k] !== undefined; })) list.push(f);
    });
    return list.filter(function (f) { return idx.fields[f] && idx.fields[f].ty !== "typeCombo"; });
  }

  // ---------- tags ----------
  function cleanTags(tags) {
    var out = {};
    Object.keys(tags || {}).forEach(function (k) {
      var ck = cleanKey(k), v = cleanVal(tags[k]);
      if (ck && v) out[ck] = v;
    });
    return out;
  }
  function applySet(tags, set) {
    var out = {};
    Object.keys(tags || {}).forEach(function (k) { out[k] = tags[k]; });
    Object.keys(set || {}).forEach(function (k) {
      if (set[k] === "") delete out[k];
      else out[k] = set[k];
    });
    return out;
  }
  function diffTags(before, after) {
    var set = {}, was = {};
    before = before || {}; after = after || {};
    Object.keys(after).forEach(function (k) {
      if (before[k] !== after[k]) { set[k] = after[k]; was[k] = before[k] === undefined ? "" : before[k]; }
    });
    Object.keys(before).forEach(function (k) {
      if (after[k] === undefined) { set[k] = ""; was[k] = before[k]; }
    });
    return { set: set, was: was };
  }
  function rebase(current, set, was) {
    var tags = applySet(current, {}), conflicts = [];
    Object.keys(set || {}).forEach(function (k) {
      var cur = current && current[k] !== undefined ? current[k] : "";
      var base = was && was[k] !== undefined ? was[k] : cur;
      if (cur !== base && cur !== set[k]) { conflicts.push(k); return; }
      if (set[k] === "") delete tags[k]; else tags[k] = set[k];
    });
    return { tags: tags, conflicts: conflicts.sort() };
  }

  // "Closed / gone" (Every Door): the business tags go, the main tag
  // becomes disused:<key>; address and building stay.
  var BUSINESS = /^(name|brand|operator|opening_hours|phone|contact:.*|website|email|cuisine|takeaway|delivery|outdoor_seating|internet_access.*|payment:.*|diet:.*|wheelchair|level|description|check_date|survey:date|fax|mobile|brand:.*|name:.*|old_name|alt_name|official_name|short_name|ref:vatin|reservation|smoking|toilets.*|air_conditioning|self_service|drive_through|capacity|fee|opening_hours:.*|branch|not:.*)$/;
  function closedTags(tags, today) {
    var out = {};
    Object.keys(tags || {}).forEach(function (k) {
      if (POI_KEYS.indexOf(k) >= 0) out["disused:" + k] = tags[k];
      else if (!BUSINESS.test(k)) out[k] = tags[k];
    });
    if (today) out.check_date = today;
    return out;
  }

  function mainTag(tags) {
    for (var i = 0; i < POI_KEYS.length; i++) {
      var k = POI_KEYS[i];
      if (tags && tags[k]) return { k: k, v: tags[k] };
    }
    return null;
  }
  function isPlace(tags) {
    var m = mainTag(tags);
    if (!m) return false;
    if (MICRO[m.k] && MICRO[m.k][m.v]) return false;
    return true;
  }

  // ---------- XML (API 0.6) ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
  }
  function tagXml(tags) {
    return Object.keys(tags || {}).sort().map(function (k) {
      return '<tag k="' + esc(k) + '" v="' + esc(tags[k]) + '"/>';
    }).join("");
  }
  function changesetXml(tags) {
    return '<osm><changeset>' + tagXml(tags) + '</changeset></osm>';
  }
  function coord(v) { return (Math.round(v * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, ""); }
  // items: [{ op, type: node|way|relation, id, version?, lat?, lon?,
  //           tags, nodes?, members? }]; ids < 0 for new nodes.
  function osmChangeXml(cs, items) {
    var groups = { create: [], modify: [], "delete": [] };
    items.forEach(function (it) {
      var a = ' id="' + it.id + '" changeset="' + cs + '"';
      if (it.op !== "create") a += ' version="' + it.version + '"';
      if (it.type === "node") a += ' lat="' + coord(it.lat) + '" lon="' + coord(it.lon) + '"';
      var inner = "";
      if (it.op !== "delete") {
        if (it.type === "way") inner += (it.nodes || []).map(function (n) { return '<nd ref="' + n + '"/>'; }).join("");
        if (it.type === "relation") {
          inner += (it.members || []).map(function (m) {
            return '<member type="' + esc(m.type) + '" ref="' + m.ref + '" role="' + esc(m.role || "") + '"/>';
          }).join("");
        }
        inner += tagXml(it.tags);
      }
      groups[it.op].push("<" + it.type + a + (inner ? ">" + inner + "</" + it.type + ">" : "/>"));
    });
    var out = '<osmChange version="0.6" generator="orOS Maps">';
    ["create", "modify", "delete"].forEach(function (op) {
      if (groups[op].length) out += "<" + op + ">" + groups[op].join("") + "</" + op + ">";
    });
    return out + "</osmChange>";
  }
  function parseDiffResult(xml) {
    var out = [];
    var re = /<(node|way|relation)\s+([^>]*?)\/?>/g, m;
    while ((m = re.exec(String(xml || "")))) {
      var attrs = {};
      m[2].replace(/(\w+)="([^"]*)"/g, function (_, k, v) { attrs[k] = v; return ""; });
      var o = +attrs.old_id;
      if (!isFinite(o)) continue;
      out.push({ type: m[1], old: o, id: attrs.new_id ? +attrs.new_id : 0, version: attrs.new_version ? +attrs.new_version : 0 });
    }
    return out;
  }

  // ---------- Overpass ----------
  function overpassQuery(s, w, n, e) {
    var b = [s, w, n, e].map(function (v) { return (+v).toFixed(6); }).join(",");
    var q = "[out:json][timeout:25];(";
    POI_KEYS.forEach(function (k) { q += 'nwr["' + k + '"](' + b + ");"; });
    return q + ");out center tags qt " + LIM.places + ";";
  }
  function parseOverpass(json) {
    var out = [];
    var els = json && Array.isArray(json.elements) ? json.elements : [];
    els.forEach(function (el) {
      if (!el || !TYPES[String(el.type || "").charAt(0)] || ["node", "way", "relation"].indexOf(el.type) < 0) return;
      if (!isNum(el.id) || el.id <= 0 || Math.floor(el.id) !== el.id) return;
      var lat = el.type === "node" ? el.lat : el.center && el.center.lat;
      var lon = el.type === "node" ? el.lon : el.center && el.center.lon;
      if (!okLat(lat) || !okLon(lon)) return;
      var tags = cleanTags(el.tags || {});
      if (!isPlace(tags)) return;
      out.push({ t: el.type.charAt(0), id: el.id, lat: lat, lon: lon, tags: tags });
    });
    return out.slice(0, LIM.places);
  }

  // ---------- opening_hours (simple shape only) ----------
  var DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  var TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
  function parseOH(s) {
    s = String(s || "").trim();
    if (!s) return [];
    if (s === "24/7") return [{ days: [1, 1, 1, 1, 1, 1, 1], times: [["00:00", "24:00"]] }];
    var rows = [];
    var parts = s.split(/\s*;\s*/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var m = p.match(/^([A-Za-z,\- ]+?)\s+(off|closed|[0-9:,\- ]+)$/);
      if (!m) return null;
      var days = [0, 0, 0, 0, 0, 0, 0];
      var dp = m[1].replace(/\s+/g, "").split(",");
      for (var j = 0; j < dp.length; j++) {
        var r = dp[j].split("-");
        var a = DAYS.indexOf(r[0]), b = r.length > 1 ? DAYS.indexOf(r[1]) : a;
        if (a < 0 || b < 0 || r.length > 2) return null;
        for (var d = a; ; d = (d + 1) % 7) { days[d] = 1; if (d === b) break; }
      }
      var times = [];
      if (!/^(off|closed)$/.test(m[2])) {
        var tp = m[2].replace(/\s+/g, "").split(",");
        for (var k = 0; k < tp.length; k++) {
          var t = tp[k].split("-");
          if (t.length !== 2 || !TIME_RE.test(t[0]) || !TIME_RE.test(t[1])) return null;
          times.push([t[0], t[1]]);
        }
      }
      rows.push({ days: days, times: times });
    }
    return rows;
  }
  function daySpec(days) {
    var out = [], i = 0;
    while (i < 7) {
      if (!days[i]) { i++; continue; }
      var j = i;
      while (j + 1 < 7 && days[j + 1]) j++;
      out.push(j === i ? DAYS[i] : (j === i + 1 ? DAYS[i] + "," + DAYS[j] : DAYS[i] + "-" + DAYS[j]));
      i = j + 1;
    }
    return out.join(",");
  }
  function formatOH(rows) {
    var parts = [];
    (rows || []).forEach(function (r) {
      var d = daySpec(r.days || []);
      if (!d) return;
      var t = (r.times || []).filter(function (x) { return TIME_RE.test(x[0]) && TIME_RE.test(x[1]); })
        .map(function (x) { return x[0] + "-" + x[1]; }).join(",");
      parts.push(d + " " + (t || "off"));
    });
    if (parts.length === 1 && parts[0] === "Mo-Su 00:00-24:00") return "24/7";
    return parts.join("; ");
  }

  // ---------- slice "mapsedits" ----------
  function normEdit(e) {
    if (!e || typeof e !== "object") return null;
    if (typeof e.id !== "string" || !ID_RE.test(e.id) || !okM(e.m) || !OPS[e.op]) return null;
    if (typeof e.dev !== "string" || !DEV_RE.test(e.dev)) return null;
    if (!TYPES[e.t]) return null;
    var o = { id: e.id, m: e.m, dev: e.dev, srv: e.srv === "dev" ? "dev" : "live", op: e.op, t: e.t };
    if (e.op === "create") {
      if (e.t !== "n" || !okLat(e.lat) || !okLon(e.lon)) return null;
      o.oid = 0;
    } else {
      if (!isNum(e.oid) || e.oid <= 0 || Math.floor(e.oid) !== e.oid) return null;
      o.oid = e.oid;
    }
    if (okLat(e.lat) && okLon(e.lon) && e.t === "n" && e.op !== "delete") {
      o.lat = Math.round(e.lat * 1e7) / 1e7;
      o.lon = Math.round(e.lon * 1e7) / 1e7;
    }
    var set = {}, was = {}, n = 0;
    Object.keys(e.set && typeof e.set === "object" ? e.set : {}).sort().forEach(function (k) {
      var ck = cleanKey(k);
      if (!ck || ck !== k || n >= LIM.set) return;
      var v = typeof e.set[k] === "string" ? cleanVal(e.set[k]) : null;
      if (v === null) return;
      set[k] = v; n++;
      var w = e.was && typeof e.was[k] === "string" ? cleanVal(e.was[k]) : "";
      if (e.op === "modify") was[k] = w;
    });
    if (e.op === "create") {
      Object.keys(set).forEach(function (k) { if (!set[k]) delete set[k]; });
      if (!Object.keys(set).length) return null;
    }
    if (e.op === "modify" && !Object.keys(set).length && o.lat === undefined) return null;
    o.set = set;
    if (e.op === "modify") o.was = was;
    o.name = cleanVal(e.name, LIM.name);
    o.pre = cleanVal(e.pre, 80);
    var err = cleanVal(e.err, LIM.err);
    if (err) o.err = err;
    return o;
  }

  function normalizeEdits(data) {
    var out = { ver: 1, edits: {}, tombs: {} };
    if (!data || typeof data !== "object") return out;
    var t = data.tombs && typeof data.tombs === "object" ? data.tombs : {};
    var tombs = {};
    Object.keys(t).forEach(function (id) { if (ID_RE.test(id) && okM(t[id])) tombs[id] = t[id]; });
    var tids = Object.keys(tombs);
    if (tids.length > LIM.tombs) {
      tids.sort(function (a, b) { return tombs[b] - tombs[a] || (a < b ? -1 : 1); });
      tids.slice(LIM.tombs).forEach(function (id) { delete tombs[id]; });
    }
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    var ed = {};
    var src = data.edits && typeof data.edits === "object" ? data.edits : {};
    Object.keys(src).forEach(function (k) {
      var e = normEdit(src[k]);
      if (!e || e.id !== k) return;
      if (out.tombs[k] !== undefined && out.tombs[k] >= e.m) return;
      ed[k] = e;
    });
    Object.keys(ed).sort(function (a, b) { return ed[b].m - ed[a].m || (a < b ? -1 : 1); })
      .slice(0, LIM.edits).sort().forEach(function (id) { out.edits[id] = ed[id]; });
    return out;
  }
  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function mergeEdits(A, B) {
    var a = normalizeEdits(A), b = normalizeEdits(B);
    var tombs = {}, edits = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (id) { tombs[id] = Math.max(tombs[id] || 0, t[id]); });
    });
    [a.edits, b.edits].forEach(function (es) {
      Object.keys(es).forEach(function (id) { edits[id] = newer(edits[id], es[id]); });
    });
    return normalizeEdits({ edits: edits, tombs: tombs });
  }

  var api = {
    VER: VER, LIM: LIM, POI_KEYS: POI_KEYS, TYPES: TYPES, ID_RE: ID_RE,
    fold: fold, canon: canon, cleanVal: cleanVal, cleanKey: cleanKey, cleanTags: cleanTags,
    presetIndex: presetIndex, matchPreset: matchPreset, presetName: presetName,
    searchPresets: searchPresets, fieldsFor: fieldsFor,
    applySet: applySet, diffTags: diffTags, rebase: rebase, closedTags: closedTags,
    mainTag: mainTag, isPlace: isPlace,
    esc: esc, changesetXml: changesetXml, osmChangeXml: osmChangeXml, parseDiffResult: parseDiffResult,
    overpassQuery: overpassQuery, parseOverpass: parseOverpass,
    parseOH: parseOH, formatOH: formatOH,
    normEdit: normEdit, normalizeEdits: normalizeEdits, mergeEdits: mergeEdits
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMapsPoi = api;
})(typeof window !== "undefined" ? window : this);
