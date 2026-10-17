// ============================================================
// orOS Mind Map — core (v1.2.0: wave 27 styles, layouts, frames, presentation)
// Everything that does not need a DOM, so the browser app and
// `node --test` run the very same code:
//   1. Constants + small helpers
//   2. Sibling order keys (fractional, base 62)
//   3. Entity normalizers (allow-list builders, never copies)
//   4. Merge (sync slice "mindmap": LWW per entity + tombstones)
//   5. Resolve a map into a tree (orphans + cycles, deterministic)
//   6. JSON export / strict JSON import
//   7. Outline text: Markdown / indented list (parse + write)
//   8. OPML (own tiny XML reader, no entity expansion)
//   9. Layout (both sides or right only, never overlapping)
//  10. Scene + SVG serializer (export) — no user text is markup
//  11. Example map (deterministic ids, R16)
//  12. Wave 27: navigation per layout, presentation steps + framing
//  13. orOS file (.orosmind): pack / unpack a map for bundle.js
// Data MINDMAP v1 (oros-mindmap-data):
//   { ver: 1,
//     maps:  [{ id, m, sides }],
//     nodes: [{ id, m, map, parent, ord, text, emoji, color,
//               note, url, done }],
//     links: [{ id, m, map, from, to, label }],     (phase 2)
//     pos:   [{ id (= node id), m, map, dx, dy }],  (phase 2)
//     imgs:  [{ id (= node id), m, map, src, w, h }], (phase 2)
//     styles: [{ id (= node id), m, map, shape, fill, border,
//                size, bold }],                       (wave 27)
//     frames: [{ id, m, map, nodes[], kind, label, color }], (wave 27)
//     layouts: [{ id (= map id), m, map (= id), kind }],     (wave 27)
//     tombs: { id: deletedAt } }
// Wave 27 follows the phase-2 rule: node styles, boundaries /
// summaries ("frames") and the map's layout kind are rows of NEW
// collections. styles / layouts share their node's / map's id, so a
// node or map tombstone removes them too; a reset writes a row of
// defaults. Frames have their own id and are tombstoned.
// Phase-2 data lives in NEW collections, never in new node fields:
// a device still on the old code rebuilds nodes from known fields,
// and on an equal-m tie its shorter row would win the canonical
// JSON comparison and drop the new fields. Unknown collections it
// simply leaves out, and the union merge on newer devices keeps them.
// pos / imgs rows share their node's id, so deleting a node (its
// tombstone) removes them too; they are never deleted on their own
// (a reset writes dx = dy = 0, removing a picture writes src "").
// A map's central node has the id `<mapId>-r` and parent "": the
// map's title IS that node's text, so there is one thing to edit.
// The parent lives on the CHILD and the sibling order is a
// fractional key (`ord`), so two devices adding or moving nodes
// change only the rows they touch (LWW on a children list would
// drop one of the additions).
// Nodes whose parent is gone, and parent loops made by two devices
// moving nodes at the same time, are resolved when the map is DRAWN
// (section 5), the same way on every device; the merge itself stays
// a plain symmetric union (R5, R26).
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VER        = 1;
  var FORMAT     = 1;
  var TEXT_LEN   = 2000;
  var NOTE_LEN   = 10000;
  var URL_LEN    = 2000;
  var EMOJI_LEN  = 8;              // code points
  var ORD_LEN    = 80;
  var MAX_MAPS   = 500;
  var MAX_NODES  = 50000;
  var IMPORT_MAX = 5 * 1024 * 1024;
  var MAX_TS     = 8640000000000000;
  var MAX_DEPTH  = 100;            // text / OPML import nesting
  var LABEL_LEN  = 200;
  var MAX_LINKS  = 5000;
  var MAX_OFF    = 100000;         // px, free-placement offset
  var IMG_LEN    = 40000;          // chars of one picture's data URI
  var IMG_TOTAL  = 1400000;        // chars of all pictures together
  var IMG_MAX    = 640;            // px, stored picture side
  var MAX_FRAMES = 2000;
  var FRAME_NODES = 50;            // members of one boundary / summary

  // Wave 27: node styles, frames, layout kinds ("" = the default).
  var SHAPES  = ["", "rect", "round", "pill", "ellipse", "diamond", "hex", "line", "none"];
  var FILLS   = ["", "none", "tint", "solid"];
  var BORDERS = ["", "none", "thin", "thick", "dashed"];
  var SIZES   = ["", "s", "l"];
  var FRAME_KINDS = ["box", "brace"];
  var LAYOUTS = ["", "org", "tree", "time"];

  // Branch colours: the shared LABEL_COLORS (Bible, Part VI).
  var COLORS = {
    red: "#e06c75", yellow: "#ecc75f", green: "#87cf3e", teal: "#4fc4cf",
    violet: "#6d4aff", pink: "#e09ecf", orange: "#f28c5a", grey: "#9aa4b0"
  };
  var COLOR_KEYS = ["red", "orange", "yellow", "green", "teal", "violet", "pink", "grey"];
  // Automatic colours of the main branches, in this order.
  var AUTO = ["teal", "orange", "violet", "green", "red", "yellow", "pink", "grey"];
  var SIDES = ["both", "right"];

  // Map ids leave room for the "-r" of their central node.
  var ID_RE  = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  var MAP_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/;
  var ORD_RE = /^[0-9A-Za-z]{1,80}$/;
  // C0/C1 controls, line/paragraph separators, bidi overrides.
  var CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
  // Quote chars as \x escapes (same regex) so string scanners stay in step.
  var URL_RE = /^https?:\/\/[^\s<>\x22\x27\x60\\]+$/i;
  var IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isTs(v) { return isInt(v) && v >= 0 && v <= MAX_TS; }
  function isId(v) { return typeof v === "string" && ID_RE.test(v); }
  function isMapId(v) { return typeof v === "string" && MAP_RE.test(v); }
  function rootId(mapId) { return mapId + "-r"; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dict() { return Object.create(null); }

  // One-line text: controls out, spaces collapsed, trimmed, capped.
  function line(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(CTRL_RE, "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Multi-line text: keeps \n, drops the other controls.
  function para(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(CTRL_RE, "").replace(/\t/g, " ")
            .replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  }
  function emoji(v) {
    var s = line(v, 64);
    return Array.from(s).slice(0, EMOJI_LEN).join("").trim();
  }
  function validUrl(v) { return typeof v === "string" && v.length <= URL_LEN && URL_RE.test(v); }
  function cleanUrl(v) {
    var s = line(v, URL_LEN);
    if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s\/]+\.[^\s\/]+/.test(s)) s = "https://" + s;
    return validUrl(s) ? s : "";
  }
  // First line of a node's text: the map title, list labels.
  function title(text, max) { return line(String(text || "").split("\n")[0], max || 80); }

  // ---------- 2. Sibling order keys ----------
  // Keys are base-62 fractions ("0.xyz"), compared as plain strings
  // (the alphabet is in ASCII order). A valid key never ends in "0",
  // so a key strictly between any two others always exists.
  var DIG = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  function validOrd(s) { return typeof s === "string" && ORD_RE.test(s) && s.charAt(s.length - 1) !== "0"; }
  // A key > a and < b. a = "" means "from the start", b = null
  // means "to the end". null when there is no room (a >= b).
  function between(a, b) {
    a = a || "";
    var open = b === null || b === undefined;
    if (!open && !(a < b)) return null;
    var out = "";
    for (var i = 0; i < ORD_LEN; i++) {
      var da = i < a.length ? DIG.indexOf(a.charAt(i)) : 0;
      var db = open ? 62 : (i < b.length ? DIG.indexOf(b.charAt(i)) : 0);
      if (da < 0 || db < 0) return null;
      if (db - da > 1) return out + DIG.charAt((da + db) >> 1);
      out += DIG.charAt(da);
      if (db !== da) open = true;
    }
    return null;
  }
  // n increasing keys spread evenly (used to re-space a crowded list).
  function spread(n) {
    var d = 1, out = [];
    while (Math.pow(62, d - 1) < (n + 1) * 2) d++;
    var span = Math.pow(62, d);
    for (var i = 1; i <= n; i++) {
      var v = Math.round(i * span / (n + 1)), s = "";
      for (var k = 0; k < d; k++) { s = DIG.charAt(v % 62) + s; v = Math.floor(v / 62); }
      out.push(s.replace(/0+$/, ""));
    }
    return out;
  }
  // Where to put a node so it lands at position `index` of the
  // sorted sibling list `sibs` (rows with id + ord, the moved node
  // already removed). Returns { ord } or, when the neighbours leave
  // no room, { ord, respace: [{ id, ord }] } for every sibling.
  function placeAt(sibs, index) {
    index = Math.max(0, Math.min(sibs.length, index));
    var lo = index > 0 ? sibs[index - 1].ord : "";
    var hi = index < sibs.length ? sibs[index].ord : null;
    var k = between(lo, hi);
    if (k && k.length <= 40) return { ord: k };
    var keys = spread(sibs.length + 1), res = [], j = 0;
    for (var i = 0; i <= sibs.length; i++) {
      if (i === index) continue;
      res.push({ id: sibs[j].id, ord: keys[i] });
      j++;
    }
    return { ord: keys[index], respace: res };
  }

  // ---------- 3. Normalizers ----------
  // Each builds a FRESH object from known fields only. Fixed key
  // order = canonical bytes (R26). null = drop the row.
  function normMap(x) {
    if (!x || typeof x !== "object" || !isMapId(x.id) || !isTs(x.m)) return null;
    return { id: x.id, m: x.m, sides: SIDES.indexOf(x.sides) !== -1 ? x.sides : "both" };
  }

  function normNode(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map)) return null;
    var isRoot = x.id === rootId(x.map);
    var parent = isRoot || !isId(x.parent) || x.parent === x.id ? "" : x.parent;
    return {
      id: x.id,
      m: x.m,
      map: x.map,
      parent: parent,
      ord: !isRoot && validOrd(x.ord) ? x.ord : "",
      text: para(x.text, TEXT_LEN),
      emoji: emoji(x.emoji),
      color: own(COLORS, x.color) ? x.color : "",
      note: para(x.note, NOTE_LEN),
      url: validUrl(x.url) ? x.url : "",
      done: x.done === true
    };
  }

  function isOff(v) { return isInt(v) && v >= -MAX_OFF && v <= MAX_OFF; }
  function validImg(v) { return typeof v === "string" && v.length <= IMG_LEN && IMG_RE.test(v); }
  function normLink(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map) ||
        !isId(x.from) || !isId(x.to) || x.from === x.to) return null;
    return { id: x.id, m: x.m, map: x.map, from: x.from, to: x.to, label: line(x.label, LABEL_LEN) };
  }
  function normPos(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map) ||
        x.id === rootId(x.map)) return null;
    return { id: x.id, m: x.m, map: x.map, dx: isOff(x.dx) ? x.dx : 0, dy: isOff(x.dy) ? x.dy : 0 };
  }
  function normImg(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map)) return null;
    var ok = validImg(x.src) && isInt(x.w) && isInt(x.h) && x.w > 0 && x.h > 0 && x.w <= IMG_MAX && x.h <= IMG_MAX;
    return { id: x.id, m: x.m, map: x.map, src: ok ? x.src : "", w: ok ? x.w : 0, h: ok ? x.h : 0 };
  }

  function pick(list, v) { return list.indexOf(v) !== -1 ? v : ""; }
  function normStyle(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map)) return null;
    return { id: x.id, m: x.m, map: x.map, shape: pick(SHAPES, x.shape), fill: pick(FILLS, x.fill),
             border: pick(BORDERS, x.border), size: pick(SIZES, x.size), bold: x.bold === true };
  }
  function plainStyle(st) { return !st || (!st.shape && !st.fill && !st.border && !st.size && !st.bold); }
  // Members: valid ids, never the centre, no repeats, sorted (canonical).
  function normFrame(x) {
    if (!x || typeof x !== "object" || !isId(x.id) || !isTs(x.m) || !isMapId(x.map) || !Array.isArray(x.nodes)) return null;
    var seen = dict(), ids = [], rid = rootId(x.map);
    x.nodes.forEach(function (id) {
      if (ids.length >= FRAME_NODES || !isId(id) || id === rid || own(seen, id)) return;
      seen[id] = 1;
      ids.push(id);
    });
    if (!ids.length) return null;
    ids.sort(cmpStr);
    return { id: x.id, m: x.m, map: x.map, nodes: ids, kind: FRAME_KINDS.indexOf(x.kind) !== -1 ? x.kind : "box",
             label: line(x.label, LABEL_LEN), color: own(COLORS, x.color) ? x.color : "" };
  }
  function normLayout(x) {
    if (!x || typeof x !== "object" || !isMapId(x.id) || x.map !== x.id || !isTs(x.m)) return null;
    return { id: x.id, m: x.m, map: x.id, kind: pick(LAYOUTS, x.kind) };
  }

  function normTombs(t, into) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return into;
    Object.keys(t).forEach(function (id) {
      if (!isId(id) || !isTs(t[id])) return;
      if (!own(into, id) || t[id] > into[id]) into[id] = t[id];
    });
    return into;
  }

  function emptyData() {
    return { ver: VER, maps: [], nodes: [], links: [], pos: [], imgs: [], styles: [], frames: [], layouts: [], tombs: {} };
  }

  // ---------- 4. Merge ----------
  // LWW per entity (newer m wins; equal m: the larger canonical
  // JSON), tombstones max-merged, delete wins ties, a newer edit
  // resurrects (R17). Nodes whose map is gone are left out: a pure
  // function of the merged maps, so every device computes the same.
  // Symmetric + idempotent + canonical (R5, R26).
  function lww(lists, norm) {
    var best = dict();
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = norm(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    return best;
  }
  function alive(best, tombs) {
    var out = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (own(tombs, id) && tombs[id] >= best[id].m) return;
      out.push(best[id]);
    });
    return out;
  }
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var tombs = normTombs(b.tombs, normTombs(a.tombs, dict()));
    var maps = alive(lww([a.maps, b.maps], normMap), tombs);
    var live = dict();
    maps.forEach(function (mp) { live[mp.id] = 1; });
    var nodes = alive(lww([a.nodes, b.nodes], normNode), tombs)
      .filter(function (n) { return own(live, n.map); });
    // Phase-2 rows hang off live nodes of the same map: a link whose
    // end was deleted, or the position / picture of a gone node, is
    // left out (delete wins), the same on every device. Zero offsets
    // and empty pictures stay: they are how a reset or a removal
    // wins over the older row on another device.
    var nodeMap = dict();
    nodes.forEach(function (n) { nodeMap[n.id] = n.map; });
    function onNode(id, mapId) { return own(nodeMap, id) && nodeMap[id] === mapId; }
    var links = alive(lww([a.links, b.links], normLink), tombs)
      .filter(function (l) { return own(live, l.map) && onNode(l.from, l.map) && onNode(l.to, l.map); })
      .slice(0, MAX_LINKS);
    var pos = alive(lww([a.pos, b.pos], normPos), tombs)
      .filter(function (x) { return onNode(x.id, x.map); });
    var imgs = alive(lww([a.imgs, b.imgs], normImg), tombs)
      .filter(function (x) { return onNode(x.id, x.map); });
    // Wave 27: a style hangs off its node like pos / imgs; a layout
    // row hangs off its map. A frame hangs off its map only: members
    // that are gone are skipped when it is drawn (filtering on them
    // here would make the merge depend on the order devices meet,
    // since a member can come back with a newer edit). The app
    // tombstones a frame when its last member is deleted.
    var styles = alive(lww([a.styles, b.styles], normStyle), tombs)
      .filter(function (x) { return onNode(x.id, x.map); });
    var frames = alive(lww([a.frames, b.frames], normFrame), tombs)
      .filter(function (f) { return own(live, f.map); })
      .slice(0, MAX_FRAMES);
    var layouts = alive(lww([a.layouts, b.layouts], normLayout), tombs)
      .filter(function (x) { return own(live, x.id); });
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sorted[id] = tombs[id]; });
    return { ver: VER, maps: maps, nodes: nodes, links: links, pos: pos, imgs: imgs,
             styles: styles, frames: frames, layouts: layouts, tombs: sorted };
  }

  // ---------- 5. Resolve ----------
  function byOrd(N) {
    return function (x, y) { return cmpStr(N[x].ord, N[y].ord) || cmpStr(x, y); };
  }
  function placeholderRoot(mapId) {
    return { id: rootId(mapId), m: 0, map: mapId, parent: "", ord: "", text: "", emoji: "",
             color: "", note: "", url: "", done: false, virtual: true };
  }
  // The tree of one map as it is drawn:
  //   { map, root, N{id:node}, kids{id:[ids]}, par{id:parentId},
  //     rec{id:1} (re-attached under the centre), count }
  // A node whose parent is missing (deleted on another device while
  // this one added under it) and the smallest id of every parent
  // loop hang from the centre, flagged `rec`. Deterministic: the
  // same data gives the same tree on every device, nothing written.
  function resolve(data, mapId) {
    var map = null;
    (data.maps || []).forEach(function (mp) { if (mp.id === mapId) map = mp; });
    var rid = rootId(mapId), N = dict(), ids = [];
    (data.nodes || []).forEach(function (n) {
      if (n.map !== mapId) return;
      N[n.id] = n;
      if (n.id !== rid) ids.push(n.id);
    });
    var rootNode = N[rid] || placeholderRoot(mapId);
    N[rid] = rootNode;
    ids.sort(cmpStr);
    var par = dict(), kids = dict(), rec = dict();
    kids[rid] = [];
    ids.forEach(function (id) {
      var p = N[id].parent;
      par[id] = p && p !== id && own(N, p) ? p : null;
      kids[id] = kids[id] || [];
    });
    ids.forEach(function (id) {
      var p = par[id];
      if (p !== null) (kids[p] = kids[p] || []).push(id);
    });
    var reach = dict();
    function mark(from) {
      var stack = [from];
      while (stack.length) {
        var x = stack.pop();
        if (own(reach, x)) continue;
        reach[x] = 1;
        var k = kids[x] || [];
        for (var i = 0; i < k.length; i++) stack.push(k[i]);
      }
    }
    mark(rid);
    function attach(id) {
      var old = par[id];
      if (old !== null && kids[old]) kids[old].splice(kids[old].indexOf(id), 1);
      par[id] = rid;
      rec[id] = 1;
      mark(id);
    }
    ids.forEach(function (x) {
      if (own(reach, x)) return;
      var seen = dict(), path = [], cur = x;
      for (;;) {
        if (own(seen, cur)) {
          var loop = path.slice(path.indexOf(cur)).sort(cmpStr);
          attach(loop[0]);
          break;
        }
        seen[cur] = 1;
        path.push(cur);
        if (par[cur] === null) { attach(cur); break; }
        cur = par[cur];
      }
    });
    var cmp = byOrd(N);
    Object.keys(kids).forEach(function (k) { kids[k].sort(cmp); });
    var normal = [], recov = [];
    kids[rid].forEach(function (id) { (rec[id] ? recov : normal).push(id); });
    Object.keys(rec).sort(cmpStr).forEach(function (id) { if (recov.indexOf(id) === -1) recov.push(id); });
    kids[rid] = normal.concat(recov.sort(cmpStr));
    var pos = dict(), img = dict(), links = [], sty = dict(), frames = [], kind = "";
    (data.styles || []).forEach(function (x) { if (x.map === mapId && own(N, x.id) && !plainStyle(x)) sty[x.id] = x; });
    (data.frames || []).forEach(function (f) { if (f.map === mapId) frames.push(f); });
    (data.layouts || []).forEach(function (x) { if (x.id === mapId) kind = x.kind; });
    (data.pos || []).forEach(function (x) { if (x.map === mapId && own(N, x.id) && x.id !== rid) pos[x.id] = x; });
    (data.imgs || []).forEach(function (x) { if (x.map === mapId && own(N, x.id) && x.src) img[x.id] = x; });
    (data.links || []).forEach(function (l) {
      if (l.map === mapId && own(N, l.from) && own(N, l.to) && l.from !== l.to) links.push(l);
    });
    return { map: map, root: rootNode, N: N, kids: kids, par: par, rec: rec, count: ids.length + 1,
             pos: pos, img: img, links: links, sty: sty, frames: frames, kind: kind };
  }
  // Ids of `id` and everything under it (iterative, any depth).
  function subtree(R, id) {
    var out = [], stack = [id];
    while (stack.length) {
      var x = stack.pop();
      out.push(x);
      var k = R.kids[x] || [];
      for (var i = k.length - 1; i >= 0; i--) stack.push(k[i]);
    }
    return out;
  }
  function depthOf(R, id) {
    var d = 0, rid = R.root.id;
    while (id !== rid && R.par[id] && d < MAX_NODES) { id = R.par[id]; d++; }
    return d;
  }
  // Would hanging `id` under `target` make it its own ancestor?
  function isInside(R, id, target) {
    var rid = R.root.id, guard = 0;
    while (target && guard++ < MAX_NODES) {
      if (target === id) return true;
      if (target === rid) return false;
      target = R.par[target];
    }
    return false;
  }
  // Main branch (child of the centre) a node belongs to.
  function branchOf(R, id) {
    var rid = R.root.id, guard = 0;
    while (id !== rid && R.par[id] !== rid && R.par[id] && guard++ < MAX_NODES) id = R.par[id];
    return id === rid ? null : id;
  }

  // ---------- 6. JSON export / import ----------
  function exportData(data, mapId, nowIso) {
    var d = merge(data, data);
    var out = { app: "mindmap", format: FORMAT, exported: String(nowIso || "") };
    if (mapId) {
      var one = function (x) { return x.map === mapId; };
      out.maps = d.maps.filter(function (mp) { return mp.id === mapId; });
      out.nodes = d.nodes.filter(one);
      out.links = d.links.filter(one); out.pos = d.pos.filter(one); out.imgs = d.imgs.filter(one);
      out.styles = d.styles.filter(one); out.frames = d.frames.filter(one); out.layouts = d.layouts.filter(one);
      out.tombs = {};
    } else {
      out.maps = d.maps; out.nodes = d.nodes; out.links = d.links; out.pos = d.pos; out.imgs = d.imgs;
      out.styles = d.styles; out.frames = d.frames; out.layouts = d.layouts;
      out.tombs = d.tombs;
    }
    return JSON.stringify(out, null, 1);
  }

  // Strict JSON import. Returns
  //   { ok: false, err: "size" | "json" | "format" | "toolarge" }
  //   { ok: true, data, stats: { maps, nodes, dropped } }
  // Nothing in the file is ever evaluated: JSON.parse, then fresh
  // objects built from known fields only. Invalid rows are dropped
  // and counted. Applying it is a merge (restore is a merge).
  function parseImport(text, local) {
    if (typeof text !== "string") return { ok: false, err: "format" };
    if (text.length > IMPORT_MAX) return { ok: false, err: "size" };
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, err: "json" }; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.app !== "mindmap" ||
        raw.format !== FORMAT || !Array.isArray(raw.maps) || !Array.isArray(raw.nodes)) {
      return { ok: false, err: "format" };
    }
    if (raw.maps.length > MAX_MAPS || raw.nodes.length > MAX_NODES) return { ok: false, err: "toolarge" };
    var st = { maps: 0, nodes: 0, dropped: 0 };
    var maps = [], nodes = [];
    raw.maps.forEach(function (r) { var x = normMap(r); if (x) maps.push(x); else st.dropped++; });
    var known = dict();
    maps.forEach(function (mp) { known[mp.id] = 1; });
    ((local && local.maps) || []).forEach(function (mp) { known[mp.id] = 1; });
    raw.nodes.forEach(function (r) {
      var x = normNode(r);
      if (x && own(known, x.map)) nodes.push(x); else st.dropped++;
    });
    function rows(list, norm) {
      if (!Array.isArray(list)) return [];
      if (list.length > MAX_NODES) { st.dropped += list.length; return []; }
      var out = [];
      list.forEach(function (r) { var x = norm(r); if (x && own(known, x.map)) out.push(x); else st.dropped++; });
      return out;
    }
    var d = merge({ maps: maps, nodes: nodes, links: rows(raw.links, normLink), pos: rows(raw.pos, normPos),
                    imgs: rows(raw.imgs, normImg), styles: rows(raw.styles, normStyle),
                    frames: rows(raw.frames, normFrame), layouts: rows(raw.layouts, normLayout),
                    tombs: normTombs(raw.tombs, dict()) }, {});
    st.maps = d.maps.length;
    st.nodes = d.nodes.length;
    return { ok: true, data: d, stats: st };
  }

  // ---------- 7. Outline text (Markdown / indented list) ----------
  // A plain tree used by every text import: { text, done, note, kids[] }
  function tnode(text) { return { text: text, done: false, note: "", kids: [] }; }

  // Markdown headings, bullet lists ("-", "*", "+", "1."), task
  // boxes ("- [x]") and plain indented lines. Returns
  //   { ok: true, tree } (the root of a plain tree) or { ok: false }
  function parseOutline(text, fallbackTitle) {
    if (typeof text !== "string" || text.length > IMPORT_MAX) return { ok: false };
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    var items = [];          // { level, text, done }
    var base = 0, stack = [], inFence = false;
    lines.forEach(function (raw) {
      if (items.length >= MAX_NODES) return;
      if (/^\s*\x60{3}/.test(raw)) { inFence = !inFence; return; }   // ``` fence
      if (inFence || !raw.trim()) return;
      var exp = raw.replace(/\t/g, "    ");
      var ind = exp.length - exp.replace(/^ +/, "").length;
      var body = exp.trim(), m, done = false;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(body))) {
        var h = m[1].length;
        items.push({ level: h - 1, text: m[2].replace(/\s+#+\s*$/, ""), done: false, head: true });
        base = h;
        stack = [];
        return;
      }
      if ((m = /^(?:[-*+]|\d{1,4}[.)])\s+(.*)$/.exec(body))) body = m[1];
      else if (/^(?:[-*+])$/.test(body)) return;
      if ((m = /^\[([ xX])\]\s+(.*)$/.exec(body))) { done = m[1] !== " "; body = m[2]; }
      while (stack.length && stack[stack.length - 1] > ind) stack.pop();
      if (!stack.length || stack[stack.length - 1] < ind) stack.push(ind);
      items.push({ level: base + stack.length - 1, text: body, done: done });
    });
    items = items.filter(function (it) { return line(it.text, TEXT_LEN) !== ""; });
    if (!items.length) return { ok: false };
    var min = Infinity;
    items.forEach(function (it) { if (it.level < min) min = it.level; });
    var tops = items.filter(function (it) { return it.level === min; }).length;
    var rootT, first = 0;
    if (tops === 1 && items[0].level === min) { rootT = tnode(line(items[0].text, TEXT_LEN)); rootT.done = items[0].done; first = 1; min++; }
    else { rootT = tnode(line(fallbackTitle, 200) || "Mind map"); rootT.fallback = true; }
    var last = [rootT];      // last node per depth (0 = root)
    for (var i = first; i < items.length; i++) {
      var it = items[i];
      var lv = Math.max(1, Math.min(MAX_DEPTH, it.level - min + 1, last.length));
      var n = tnode(line(it.text, TEXT_LEN));
      n.done = it.done;
      last[lv - 1].kids.push(n);
      last.length = lv;
      last[lv] = n;
    }
    return { ok: true, tree: rootT };
  }

  // Map (resolved) → Markdown: "# centre", then "- " items, two
  // spaces per level, "- [x]" for done ones. Notes are left out
  // (OPML and JSON carry them).
  function toOutline(R, fromId) {
    var start = fromId || R.root.id, out = [];
    var top = R.N[start];
    out.push((start === R.root.id ? "# " : "- ") + oneLine(top.text));
    var stack = [];
    var k = R.kids[start] || [];
    for (var i = k.length - 1; i >= 0; i--) stack.push([k[i], 0]);
    while (stack.length) {
      var e = stack.pop(), n = R.N[e[0]];
      var pre = start === R.root.id ? "" : "  ";
      out.push(pre + new Array(e[1] + 1).join("  ") + "- " + (n.done ? "[x] " : "") + oneLine(n.text));
      var kk = R.kids[e[0]] || [];
      for (var j = kk.length - 1; j >= 0; j--) stack.push([kk[j], e[1] + 1]);
    }
    return out.join("\n") + "\n";
  }
  function oneLine(s) { return String(s || "").replace(/\s*\n\s*/g, " ").trim(); }

  // ---------- 8. OPML ----------
  var ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function decodeEnt(s) {
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, function (all, e) {
      if (e.charAt(0) === "#") {
        var c = e.charAt(1) === "x" || e.charAt(1) === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(c > 0 && c <= 0x10ffff) || (c >= 0xd800 && c <= 0xdfff)) return "";
        return String.fromCodePoint(c);
      }
      return own(ENT, e) ? ENT[e] : "";     // unknown entities vanish, never expand
    });
  }
  // A deliberately small XML reader: elements + attributes only.
  // DOCTYPE, comments, processing instructions and CDATA are
  // skipped; custom entities never expand (no billion laughs, no
  // external entities). Returns the element tree or null.
  function readXml(text) {
    var re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    var top = { name: "#doc", attrs: dict(), kids: [], _text: "" }, stack = [top], m, count = 0, last = 0;
    function addText(s) {
      var cur = stack[stack.length - 1];
      if (cur._text.length < TEXT_LEN) cur._text = (cur._text + s).slice(0, TEXT_LEN);
    }
    while ((m = re.exec(text))) {
      if (m.index > last) addText(decodeEnt(text.slice(last, m.index)));
      last = re.lastIndex;
      if (m[0].indexOf("<![CDATA[") === 0) { addText(m[0].slice(9, -3)); continue; }
      if (m[1]) {
        if (stack.length > 1 && stack[stack.length - 1].name === m[1]) stack.pop();
        else return null;
      } else if (m[2]) {
        if (++count > MAX_NODES + 50) return null;
        var el = { name: m[2], attrs: dict(), kids: [], _text: "" };
        var ar = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, a;
        while ((a = ar.exec(m[3]))) {
          if (!own(el.attrs, a[1])) el.attrs[a[1]] = decodeEnt(a[2] !== undefined ? a[2] : a[3]);
        }
        stack[stack.length - 1].kids.push(el);
        if (!m[4]) {
          if (stack.length > MAX_DEPTH + 10) return null;
          stack.push(el);
        }
      }
    }
    return stack.length === 1 ? top : null;
  }
  function parseOpml(text, fallbackTitle) {
    if (typeof text !== "string" || text.length > IMPORT_MAX) return { ok: false, err: "size" };
    var doc = readXml(text);
    var opml = doc && doc.kids.filter(function (k) { return k.name === "opml"; })[0];
    if (!opml) return { ok: false, err: "format" };
    var body = opml.kids.filter(function (k) { return k.name === "body"; })[0];
    var head = opml.kids.filter(function (k) { return k.name === "head"; })[0];
    var ttl = head && head.kids.filter(function (k) { return k.name === "title"; })[0];
    if (!body) return { ok: false, err: "format" };
    var outs = body.kids.filter(function (k) { return k.name === "outline"; });
    if (!outs.length) return { ok: false, err: "empty" };
    var n = 0;
    // Recursion depth is bounded by readXml (nesting ≤ MAX_DEPTH + 10).
    function conv(el) {
      var t = tnode(para(el.attrs.text !== undefined ? el.attrs.text : (el.attrs.title || ""), TEXT_LEN));
      t.note = para(el.attrs._note || "", NOTE_LEN);
      t.done = el.attrs._complete === "true";
      n++;
      el.kids.forEach(function (k) {
        if (k.name === "outline" && n < MAX_NODES) t.kids.push(conv(k));
      });
      return t;
    }
    var rootT;
    if (outs.length === 1) rootT = conv(outs[0]);
    else {
      rootT = tnode(line(ttl && ttl._text, 200) || line(fallbackTitle, 200) || "Mind map");
      rootT.fallback = true;
      outs.forEach(function (o) { if (n < MAX_NODES) rootT.kids.push(conv(o)); });
    }
    return { ok: true, tree: rootT };
  }
  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "&#10;");
  }
  function toOpml(R, fromId, nowIso) {
    var start = fromId || R.root.id;
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', "<head>",
      "<title>" + escXml(title(R.N[R.root.id].text, 200)) + "</title>",
      "<dateCreated>" + escXml(nowIso || "") + "</dateCreated>", "</head>", "<body>"];
    // iterative: [id, depth, closing?]
    var stack = [[start, 1, false]];
    while (stack.length) {
      var e = stack.pop(), pad = new Array(e[1] + 1).join("  ");
      if (e[2]) { out.push(pad + "</outline>"); continue; }
      var n = R.N[e[0]], k = R.kids[e[0]] || [];
      var tag = pad + '<outline text="' + escXml(n.text) + '"' +
        (n.note ? ' _note="' + escXml(n.note) + '"' : "") + (n.done ? ' _complete="true"' : "");
      if (!k.length) { out.push(tag + "/>"); continue; }
      out.push(tag + ">");
      stack.push([e[0], e[1], true]);
      for (var i = k.length - 1; i >= 0; i--) stack.push([k[i], e[1] + 1, false]);
    }
    out.push("</body>", "</opml>");
    return out.join("\n") + "\n";
  }
  // Plain tree → node rows for a NEW map (fresh ids from newId()),
  // or, with `under` = { map, parent, keys[] }, its top items (the
  // root itself when the text had one title, else the root's kids)
  // under an existing node at the given order keys.
  // Tree nodes may also carry url, color, emoji and `ref` (the id in
  // the source file); the root may carry links [{from, to, label}]
  // between refs (FreeMind / XMind), which become cross-links.
  // Returns { map (or null), nodes[], links[] }.
  function topsOf(tree) { return tree.fallback ? tree.kids : [tree]; }
  function treeToRows(tree, newId, now, under) {
    var nodes = [], mapRow = null, rootRowId, mapId, tops, keys0, byRef = dict();
    function extra(row, t) {
      row.emoji = t.emoji || ""; row.color = t.color || ""; row.url = t.url || "";
      if (typeof t.ref === "string" && t.ref && !own(byRef, t.ref)) byRef[t.ref] = row.id;
      return row;
    }
    if (under) { mapId = under.map; tops = topsOf(tree); keys0 = under.keys; }
    else {
      mapId = newId();
      mapRow = { id: mapId, m: now, sides: "both" };
      rootRowId = rootId(mapId);
      nodes.push(extra({ id: rootRowId, m: now, map: mapId, parent: "", ord: "", text: tree.text,
                   note: tree.note || "", done: !!tree.done }, tree));
      tops = tree.kids;
      keys0 = spread(tops.length);
    }
    var stack = [];
    for (var i = tops.length - 1; i >= 0; i--) stack.push([tops[i], under ? under.parent : rootRowId, keys0[i]]);
    while (stack.length && nodes.length < MAX_NODES) {
      var e = stack.pop(), t = e[0], id = newId();
      nodes.push(extra({ id: id, m: now, map: mapId, parent: e[1], ord: e[2], text: t.text,
                   note: t.note || "", done: !!t.done }, t));
      var ks = spread(t.kids.length);
      for (var j = t.kids.length - 1; j >= 0; j--) stack.push([t.kids[j], id, ks[j]]);
    }
    var links = [];
    (Array.isArray(tree.links) ? tree.links : []).forEach(function (l) {
      if (!l || links.length >= MAX_LINKS) return;
      var a = own(byRef, l.from) ? byRef[l.from] : "", b = own(byRef, l.to) ? byRef[l.to] : "";
      if (!a || !b || a === b) return;
      var x = normLink({ id: newId(), m: now, map: mapId, from: a, to: b, label: l.label });
      if (x) links.push(x);
    });
    return { map: mapRow, nodes: nodes.map(normNode).filter(Boolean), links: links };
  }

  // ---------- 9. Layout ----------
  // measure(text, fontPx, weight) → width in px (canvas in the
  // browser; an estimate in node).
  function estimate(text, px) { return Array.from(String(text)).length * px * 0.56; }
  var STY = [
    { font: 18, weight: 800, lh: 24, px: 18, py: 11, max: 260 },
    { font: 15, weight: 700, lh: 20, px: 13, py: 8,  max: 240 },
    { font: 14, weight: 400, lh: 19, px: 10, py: 6,  max: 240 }
  ];
  var HGAP = [64, 40, 32], VGAP = [18, 10, 8];
  var IMG_BOX = [[200, 150], [180, 135], [160, 120]];   // picture fits in w × h, per depth
  var IMG_GAP = 6;
  var LINK_FONT = 12, LINK_PAD = 6, LINK_H = 20;
  var MAX_LINES = 12;
  function styleAt(d) { return STY[Math.min(d, 2)]; }

  // Greedy word wrap to `max` px; long words break by character.
  function wrap(text, sty, measure) {
    var out = [];
    var paras = String(text).split("\n");
    for (var p = 0; p < paras.length && out.length <= MAX_LINES; p++) {
      var words = paras[p].split(/ +/), cur = "";
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        var trial = cur ? cur + " " + word : word;
        if (measure(trial, sty.font, sty.weight) <= sty.max) { cur = trial; continue; }
        if (cur) { out.push(cur); cur = ""; }
        while (measure(word, sty.font, sty.weight) > sty.max) {
          var chars = Array.from(word), k = chars.length - 1;
          while (k > 1 && measure(chars.slice(0, k).join(""), sty.font, sty.weight) > sty.max) k--;
          out.push(chars.slice(0, k).join(""));
          word = chars.slice(k).join("");
        }
        cur = word;
      }
      out.push(cur);
    }
    if (out.length > MAX_LINES) { out = out.slice(0, MAX_LINES); out[MAX_LINES - 1] += "…"; }
    return out;
  }

  // Picture size inside a node at `depth` (aspect kept, never upscaled).
  function imgFit(im, depth) {
    var box = IMG_BOX[Math.min(depth, 2)], k = Math.min(1, box[0] / im.w, box[1] / im.h);
    return { w: Math.max(1, Math.round(im.w * k)), h: Math.max(1, Math.round(im.h * k)) };
  }
  // Where the segment from a box's centre towards (tx, ty) leaves the box.
  function exitPoint(c, tx, ty) {
    var dx = tx - c.cx, dy = ty - c.cy;
    if (!dx && !dy) return { x: c.cx, y: c.cy };
    var kx = dx ? (c.w / 2) / Math.abs(dx) : Infinity, ky = dy ? (c.h / 2) / Math.abs(dy) : Infinity;
    var k = Math.min(kx, ky, 1);
    return { x: c.cx + dx * k, y: c.cy + dy * k };
  }

  // Wave 27: a node's own style scales its text and gives it a shape.
  var SIZE_K = { s: 0.85, l: 1.3 };
  function textStyle(depth, st) {
    var b = styleAt(depth);
    if (!st || (!st.size && !st.bold)) return b;
    var k = SIZE_K[st.size] || 1;
    return { font: Math.round(b.font * k), weight: st.bold ? 800 : b.weight, lh: Math.round(b.lh * k),
             px: Math.round(b.px * k), py: Math.round(b.py * k), max: Math.round(b.max * (k > 1 ? 1.2 : 1)) };
  }
  // Room around the text block so it stays inside the shape.
  function shapePad(shape, w, h) {
    if (shape === "ellipse") return [Math.round(w * 0.17) + 4, Math.round(h * 0.2) + 2];
    if (shape === "diamond") return [Math.round(w * 0.5), Math.round(h * 0.5)];
    if (shape === "hex") return [Math.round(h * 0.35), 0];
    return [0, 0];
  }
  var FPAD = 8, FLBL = 12, FRAME_FONT = 12, FRAME_H = 20, BRACE = 14;
  var ORG_H = [28, 20, 14], ORG_V = [48, 36, 30];       // org chart: sibling gap, level gap
  var TREE_IND = 30, TREE_V = [16, 10, 6], TIME_GAP = 44;

  // opts: { measure, fold{id:1}, placeholder, margin }
  // → { kind, nodes{id:{id,x,y,w,h,cx,cy,depth,side,flow,sib,lines,sty,
  //            color,folded,hidden,rec,ind,img,moved,shape,st,ex,ey}},
  //     order[], edges[], links[], frames[], w, h }
  // Kinds (R.kind): "" = the classic map (both sides or right only,
  // R.map.sides), "org" = org chart (down), "tree" = indented tree,
  // "time" = timeline (main branches along a line, each with its
  // ideas as a tree below). None of them lets two boxes overlap.
  // Free placement: a node's stored offset (R.pos) moves it AND its
  // whole branch from the automatic place (offsets add up down the
  // tree), so the automatic layout stays the base.
  function layout(R, opts) {
    opts = opts || {};
    var measure = opts.measure || estimate, fold = opts.fold || {}, M = opts.margin === undefined ? 40 : opts.margin;
    var rid = R.root.id, L = dict(), order = [], STS = R.sty || {};
    var kind = R.kind && LAYOUTS.indexOf(R.kind) > 0 ? R.kind : "";
    var sides = kind ? "right" : (R.map && R.map.sides === "right" ? "right" : "both");
    var top = R.kids[rid] || [];
    var rightN = sides === "right" ? top.length : Math.ceil(top.length / 2);

    // 1. visible nodes, depth, side, size (pre-order, iterative)
    var stack = [[rid, 0, 0, null]];
    while (stack.length) {
      var e = stack.pop(), id = e[0], depth = e[1], n = R.N[id];
      var st = own(STS, id) ? STS[id] : null, shape = st ? st.shape : "";
      var sty = textStyle(depth, st);
      var wsty = shape === "diamond" || shape === "ellipse" ? { font: sty.font, weight: sty.weight, max: Math.round(sty.max * 0.7) } : sty;
      var txt = (n.emoji ? n.emoji + " " : "") + (n.text || (id === rid ? (opts.placeholder || "") : "…"));
      var lines = wrap(txt, wsty, measure), wmax = 0;
      lines.forEach(function (l) { wmax = Math.max(wmax, measure(l, sty.font, sty.weight)); });
      var ind = (n.note ? 1 : 0) + (n.url ? 1 : 0);
      var im = R.img && R.img[id] ? imgFit(R.img[id], depth) : null;
      var kids = R.kids[id] || [];
      var isFold = kids.length > 0 && id !== rid && own(fold, id);
      var color;
      if (depth === 0) color = "";
      else if (depth === 1) color = n.color || AUTO[e[2] % AUTO.length];
      else color = n.color || e[3];
      var side = depth === 0 ? "c" : (depth === 1 ? (e[2] < rightN ? "r" : "l") : e[4]);
      var iw = Math.ceil(Math.max(wmax + ind * 16, 24, im ? im.w : 0) + sty.px * 2);
      var ih = lines.length * sty.lh + sty.py * 2 + (im ? im.h + IMG_GAP : 0);
      var pad = shapePad(shape, iw, ih);
      L[id] = {
        id: id, depth: depth, side: side, lines: lines, sty: sty, color: color,
        w: iw + pad[0] * 2, h: ih + pad[1] * 2, ex: pad[0], ey: pad[1], shape: shape, st: st,
        folded: isFold, hidden: 0, rec: !!R.rec[id], ind: ind, img: im, moved: false, kids: []
      };
      order.push(id);
      if (isFold) continue;
      for (var i = kids.length - 1; i >= 0; i--) {
        stack.push([kids[i], depth + 1, depth === 0 ? i : 0, color, side]);
      }
    }
    order.forEach(function (id) {
      if (id === rid) return;
      L[R.par[id]].kids.push(id);
    });
    // hidden counts of folded nodes
    order.forEach(function (id) { if (L[id].folded) L[id].hidden = subtree(R, id).length - 1; });

    // room for boundaries / summaries: the outer members of a frame
    // (per parent) get extra space before and after them
    var fpad = dict();
    (R.frames || []).forEach(function (f) {
      var by = dict();
      f.nodes.forEach(function (id) {
        if (!own(L, id) || id === rid) return;
        var key = R.par[id] + "|" + L[id].side;
        (by[key] = by[key] || []).push(id);
      });
      var room = f.kind === "brace" ? 4 : FPAD + (f.label ? FLBL : 0);
      Object.keys(by).forEach(function (key) {
        var sibs = L[R.par[by[key][0]]].kids, g = by[key].sort(function (x, y) { return sibs.indexOf(x) - sibs.indexOf(y); });
        [g[0], g[g.length - 1]].forEach(function (x) { fpad[x] = Math.max(fpad[x] || 0, room); });
      });
    });
    function pd(id) { return fpad[id] || 0; }

    // 2. block sizes, bottom-up; 3. positions, top-down
    var R0 = L[rid];
    R0.x = -R0.w / 2; R0.y = -R0.h / 2;
    var blk = dict(), o, q, nd, kk, sum, gap;
    if (!kind) {
      for (o = order.length - 1; o >= 0; o--) {
        nd = L[order[o]];
        if (nd.depth === 0) continue;
        sum = 0; kk = nd.kids; gap = VGAP[Math.min(nd.depth + 1, 2)];
        for (q = 0; q < kk.length; q++) sum += blk[kk[q]] + (q ? gap : 0);
        blk[nd.id] = Math.max(nd.h, sum) + 2 * pd(nd.id);
      }
      var right = R0.kids.filter(function (id) { return L[id].side === "r"; });
      var left = R0.kids.filter(function (id) { return L[id].side === "l"; }).reverse();   // clockwise
      var place = function (list, parent) {
        var g = VGAP[Math.min(parent.depth + 1, 2)], total = 0;
        list.forEach(function (id, i) { total += blk[id] + (i ? g : 0); });
        var y = parent.y + parent.h / 2 - total / 2;
        list.forEach(function (id) {
          var c = L[id], hg = HGAP[Math.min(parent.depth, 2)];
          c.y = y + blk[id] / 2 - c.h / 2;
          c.x = c.side === "l" ? parent.x - hg - c.w : parent.x + parent.w + hg;
          y += blk[id] + g;
        });
      };
      place(right, R0);
      place(left, R0);
      for (var z = 0; z < order.length; z++) {
        var pn = L[order[z]];
        if (pn.depth === 0 || !pn.kids.length) continue;
        place(pn.kids, pn);
      }
    } else if (kind === "org") {
      for (o = order.length - 1; o >= 0; o--) {
        nd = L[order[o]];
        sum = 0; kk = nd.kids; gap = ORG_H[Math.min(nd.depth, 2)];
        for (q = 0; q < kk.length; q++) sum += blk[kk[q]] + (q ? gap : 0);
        blk[nd.id] = Math.max(nd.w, sum) + 2 * pd(nd.id);
      }
      order.forEach(function (id) {
        var p = L[id], ks = p.kids, g = ORG_H[Math.min(p.depth, 2)], total = 0;
        ks.forEach(function (k, i) { total += blk[k] + (i ? g : 0); });
        var x = p.x + p.w / 2 - total / 2;
        ks.forEach(function (k) {
          var c = L[k];
          c.x = x + blk[k] / 2 - c.w / 2;
          c.y = p.y + p.h + ORG_V[Math.min(p.depth, 2)];
          x += blk[k] + g;
        });
      });
    } else {
      // tree rows (tree, and under each main branch of a timeline)
      var wide = dict();
      for (o = order.length - 1; o >= 0; o--) {
        nd = L[order[o]];
        sum = nd.h; kk = nd.kids; gap = TREE_V[Math.min(nd.depth + 1, 2)];
        var wv = nd.w + (nd.folded ? 26 : 0);
        for (q = 0; q < kk.length; q++) { sum += gap + blk[kk[q]]; wv = Math.max(wv, TREE_IND + wide[kk[q]]); }
        blk[nd.id] = sum + 2 * pd(nd.id);
        wide[nd.id] = wv;
      }
      var treeKids = function (p) {
        var y = p.y + p.h, g = TREE_V[Math.min(p.depth + 1, 2)];
        p.kids.forEach(function (k) {
          var c = L[k];
          y += g;
          c.x = p.x + TREE_IND;
          c.y = y + pd(k);
          y += blk[k];
        });
      };
      if (kind === "time") {
        var tx = R0.x + R0.w + TIME_GAP;
        R0.kids.forEach(function (k) {
          var c = L[k];
          tx += pd(k);
          c.x = tx;
          c.y = R0.y + R0.h / 2 - c.h / 2;
          tx += wide[k] + pd(k) + TIME_GAP;
        });
      }
      order.forEach(function (id) {
        if (kind === "time" && id === rid) return;
        treeKids(L[id]);
      });
    }
    // free placement: cumulative offsets, pre-order (parents first)
    var off = dict();
    off[rid] = [0, 0];
    order.forEach(function (id) {
      if (id === rid) return;
      var po = off[R.par[id]] || [0, 0], p = R.pos && R.pos[id];
      var ov = p && (p.dx || p.dy) ? [po[0] + p.dx, po[1] + p.dy] : po;
      off[id] = ov;
      if (p && (p.dx || p.dy)) L[id].moved = true;
      L[id].x += ov[0]; L[id].y += ov[1];
    });

    order.forEach(function (id) { var c = L[id]; c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2; });
    // Which way a node's branch flows (edges and the fold badge
    // follow it): l / r (map; a branch moved across its parent flows
    // the other way), d (org chart), t (tree rows). sib: the axis its
    // siblings are lined up on (h or v), for drops and the keyboard.
    order.forEach(function (id) {
      var c = L[id];
      c.sib = kind === "org" || (kind === "time" && c.depth === 1) ? "h" : "v";
      if (id === rid) { c.flow = kind === "org" ? "d" : (kind ? "t" : "c"); return; }
      var p = L[R.par[id]];
      c.flow = kind === "org" ? "d" : (kind ? "t" : (c.cx < p.cx ? "l" : "r"));
    });

    // cross-links between visible ends (a folded-away end uses its
    // nearest visible ancestor; both ends on one node → not drawn)
    function shown(id) {
      var guard = 0;
      while (id && !L[id] && guard++ < MAX_NODES) id = R.par[id];
      return id && L[id] ? id : null;
    }
    var links = [];
    (R.links || []).forEach(function (l) {
      var a = shown(l.from), b = shown(l.to);
      if (!a || !b || a === b) return;
      var A = L[a], B = L[b];
      var mx = (A.cx + B.cx) / 2, my = (A.cy + B.cy) / 2, len = Math.hypot(B.cx - A.cx, B.cy - A.cy) || 1;
      // bulge away from the centre, so links between nodes of one
      // column curve out beside it instead of over the boxes; the
      // ends leave the boxes towards the bend
      var bend = Math.max(60, Math.min(120, len * 0.4)), nx = -(B.cy - A.cy) / len, ny = (B.cx - A.cx) / len;
      var C0 = L[rid], qx = mx + nx * bend, qy = my + ny * bend, ox = mx - nx * bend, oy = my - ny * bend;
      if (Math.hypot(ox - C0.cx, oy - C0.cy) > Math.hypot(qx - C0.cx, qy - C0.cy)) { qx = ox; qy = oy; }
      var p1 = exitPoint(A, qx, qy), p2 = exitPoint(B, qx, qy);
      // label sits on the curve's midpoint (t = 0.5 of the quadratic)
      var lx = (p1.x + 2 * qx + p2.x) / 4, ly = (p1.y + 2 * qy + p2.y) / 4;
      var lw = l.label ? Math.ceil(measure(l.label, LINK_FONT, 600) + LINK_PAD * 2) : 0;
      links.push({ id: l.id, from: a, to: b, x1: p1.x, y1: p1.y, qx: qx, qy: qy, x2: p2.x, y2: p2.y,
                   label: l.label, lx: lx, ly: ly, lw: lw, lh: l.label ? LINK_H : 0 });
    });

    // boundaries (box) and summaries (brace) around their visible
    // members and everything shown under them. Members under another
    // parent, or on the other side of the centre, get a box of their
    // own (one frame can be drawn in parts; the label goes on the
    // first), so a frame never swallows the centre.
    var frames = [];
    (R.frames || []).forEach(function (f) {
      var vis = f.nodes.filter(function (id) { return own(L, id) && id !== rid; }), parts = [], at = dict(), set = dict();
      vis.forEach(function (id) { set[id] = 1; });
      vis.forEach(function (id) {
        // a member inside another member's branch is already framed
        for (var up = R.par[id], g = 0; up && up !== rid && g < MAX_NODES; up = R.par[up], g++) if (own(set, up)) return;
        var key = R.par[id] + "|" + L[id].flow;
        if (!own(at, key)) { at[key] = parts.length; parts.push([]); }
        parts[at[key]].push(id);
      });
      parts.forEach(function (mem, pi) { framePart(f, mem, pi); });
    });
    function framePart(f, mem, pi) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, st = mem.slice(), seen = dict();
      while (st.length) {
        var x = st.pop(), c = L[x];
        if (own(seen, x)) continue;
        seen[x] = 1;
        x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
        for (var j = 0; j < c.kids.length; j++) st.push(c.kids[j]);
      }
      var first = L[mem[0]], lbl = pi ? "" : f.label, lw = lbl ? Math.ceil(measure(lbl, FRAME_FONT, 700) + 16) : 0;
      var fr = { id: f.id, part: pi, kind: f.kind, label: lbl, color: f.color || first.color || "grey", nodes: mem,
                 x: x0 - FPAD, y: y0 - FPAD, w: x1 - x0 + 2 * FPAD, h: y1 - y0 + 2 * FPAD, lw: lw, lh: lbl ? FRAME_H : 0 };
      if (f.kind === "brace") {
        // the brace stands on the side the branch grows to
        var side = first.flow === "l" ? "l" : (first.flow === "d" ? "d" : "r");
        fr.side = side;
        if (side === "d") {
          fr.bx0 = x0; fr.bx1 = x1; fr.by0 = fr.by1 = y1 + 4; fr.tx = (x0 + x1) / 2; fr.ty = y1 + 4 + BRACE;
          fr.lx = fr.tx - lw / 2; fr.ly = fr.ty + 4;
        } else {
          var bx = side === "l" ? x0 - 4 : x1 + 4;
          fr.bx0 = fr.bx1 = bx; fr.by0 = y0; fr.by1 = y1; fr.ty = (y0 + y1) / 2;
          fr.tx = side === "l" ? bx - BRACE : bx + BRACE;
          fr.lx = side === "l" ? fr.tx - 6 - lw : fr.tx + 6; fr.ly = fr.ty - FRAME_H / 2;
        }
      } else { fr.lx = fr.x + 12; fr.ly = fr.y - FRAME_H / 2; }
      frames.push(fr);
    }

    // 4. bounds → shift so the drawing starts at (M, M)
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(gx0, gy0, gx1, gy1) {
      minX = Math.min(minX, gx0); minY = Math.min(minY, gy0); maxX = Math.max(maxX, gx1); maxY = Math.max(maxY, gy1);
    }
    order.forEach(function (id) {
      var c = L[id], extra = c.folded ? 26 : 0, lf = id !== rid && c.flow === "l";
      if (c.flow === "d") grow(c.x, c.y, c.x + c.w, c.y + c.h + extra);
      else grow(c.x - (lf ? extra : 0), c.y, c.x + c.w + (lf ? 0 : extra), c.y + c.h);
    });
    links.forEach(function (k) {
      grow(Math.min(k.qx, k.lx - k.lw / 2), Math.min(k.qy, k.ly - k.lh / 2),
           Math.max(k.qx, k.lx + k.lw / 2), Math.max(k.qy, k.ly + k.lh / 2));
    });
    frames.forEach(function (f) {
      if (f.kind === "brace") grow(Math.min(f.bx0, f.tx), Math.min(f.by0, f.ty), Math.max(f.bx1, f.tx), Math.max(f.by1, f.ty));
      else grow(f.x, f.y, f.x + f.w, f.y + f.h);
      if (f.lw) grow(f.lx, f.ly, f.lx + f.lw, f.ly + f.lh);
    });
    var dx = Math.round(M - minX), dy = Math.round(M - minY);
    order.forEach(function (id) {
      var c = L[id];
      c.x = Math.round(c.x + dx); c.y = Math.round(c.y + dy);
      c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2;
    });
    links.forEach(function (k) {
      k.x1 += dx; k.y1 += dy; k.qx += dx; k.qy += dy; k.x2 += dx; k.y2 += dy; k.lx += dx; k.ly += dy;
    });
    frames.forEach(function (f) {
      f.x += dx; f.y += dy; f.lx += dx; f.ly += dy;
      if (f.kind === "brace") { f.bx0 += dx; f.bx1 += dx; f.by0 += dy; f.by1 += dy; f.tx += dx; f.ty += dy; }
    });
    var edges = [];
    order.forEach(function (id) {
      if (id === rid) return;
      var c = L[id], p = L[R.par[id]], ed = { from: p.id, to: id, color: c.color, depth: c.depth, rec: c.rec };
      if (kind === "org") {
        ed.shape = "v"; ed.x1 = p.cx; ed.y1 = p.y + p.h; ed.x2 = c.cx; ed.y2 = c.y;
      } else if (kind === "time" && c.depth === 1) {
        // the time line: from the previous main branch (or the centre)
        var i = p.kids.indexOf(id), prev = i > 0 ? L[p.kids[i - 1]] : p;
        ed.shape = "s"; ed.x1 = prev.x + prev.w; ed.y1 = prev.cy; ed.x2 = c.x; ed.y2 = c.cy;
      } else if (kind) {
        ed.shape = "e"; ed.x1 = p.x + Math.min(TREE_IND / 2, p.w / 2); ed.y1 = p.y + p.h; ed.x2 = c.x; ed.y2 = c.cy;
        // a pointed or round shape has no corner there: leave from its left tip
        if (p.shape === "diamond" || p.shape === "ellipse" || p.shape === "hex") { ed.x1 = p.x; ed.y1 = p.cy; }
      } else {
        var lf = c.flow === "l";
        ed.shape = "c"; ed.x1 = lf ? p.x : p.x + p.w; ed.x2 = lf ? c.x + c.w : c.x; ed.y1 = p.cy; ed.y2 = c.cy;
        if (p.depth === 0) ed.x1 = p.cx + (lf ? -1 : 1) * p.w * 0.3;
      }
      edges.push(ed);
    });
    return { kind: kind, nodes: L, order: order, edges: edges, links: links, frames: frames,
             w: Math.ceil(maxX - minX + 2 * M), h: Math.ceil(maxY - minY + 2 * M) };
  }

  // ---------- 10. Scene + SVG ----------
  // One list of drawing items for both the live SVG (DOM, built with
  // createElementNS + textContent) and the exported file (string,
  // every attribute escaped). Colours come from `pal`, validated.
  var TAGS = { g: 1, rect: 1, path: 1, text: 1, tspan: 1, circle: 1, title: 1, image: 1 };
  var ATTRS = { x: 1, y: 1, dy: 1, width: 1, height: 1, rx: 1, d: 1, cx: 1, cy: 1, r: 1,
                fill: 1, stroke: 1, "stroke-width": 1, "stroke-dasharray": 1, "fill-opacity": 1,
                "stroke-opacity": 1, opacity: 1, "font-size": 1, "font-weight": 1, "text-anchor": 1,
                "text-decoration": 1, "data-id": 1, "data-fold": 1, "stroke-linecap": 1,
                "data-link": 1, "data-frame": 1, href: 1, preserveAspectRatio: 1, "stroke-linejoin": 1 };
  var COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|transparent|none)$/;
  var THEMES = {
    light: { bg: "#ffffff", panel: "#ffffff", text: "#1f2328", dim: "#5f6670", border: "#d0d4da",
             accent: "#3b6fd8", onAccent: "#ffffff" },
    dark:  { bg: "#16181d", panel: "#20232a", text: "#eceff4", dim: "#9aa2ad", border: "#3a3f4a",
             accent: "#d4af37", onAccent: "#16181d" }
  };
  function pc(pal, k) {
    var v = pal && typeof pal[k] === "string" ? pal[k].trim() : "";
    return COLOR_RE.test(v) ? v : THEMES.light[k];
  }
  function hex(key) { return own(COLORS, key) ? COLORS[key] : COLORS.grey; }
  function curve(e) {
    var x1 = r1(e.x1), y1 = r1(e.y1), x2 = r1(e.x2), y2 = r1(e.y2);
    if (e.shape === "s") return "M" + x1 + " " + y1 + "L" + x2 + " " + y2;
    if (e.shape === "v") {
      var my = r1((e.y1 + e.y2) / 2);
      return "M" + x1 + " " + y1 + "C" + x1 + " " + my + " " + x2 + " " + my + " " + x2 + " " + y2;
    }
    if (e.shape === "e") {
      // elbow: down from the parent, then across into the child
      var rr = Math.min(8, Math.abs(e.y2 - e.y1), Math.abs(e.x2 - e.x1)), sx = e.x2 >= e.x1 ? 1 : -1;
      return "M" + x1 + " " + y1 + "L" + x1 + " " + r1(e.y2 - rr) + "Q" + x1 + " " + y2 + " " + r1(e.x1 + sx * rr) + " " + y2 +
        "L" + x2 + " " + y2;
    }
    var mx = r1((e.x1 + e.x2) / 2);
    return "M" + x1 + " " + y1 + "C" + mx + " " + y1 + " " + mx + " " + y2 + " " + x2 + " " + y2;
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  // Colours as [r, g, b] (#rgb, #rrggbb, rgb()), null otherwise.
  function rgbOf(c) {
    var s = String(c || "").trim(), m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return m[1].split("").map(function (h) { return parseInt(h + h, 16); });
    if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s))) return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16); });
    if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s))) return [+m[1], +m[2], +m[3]].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))); });
    return null;
  }
  function hex2(v) { var s = Math.round(v).toString(16); return s.length < 2 ? "0" + s : s; }
  // `a` blended into `b` (k = share of a); a when b is not a colour.
  function mix(a, b, k) {
    var A = rgbOf(a), B = rgbOf(b);
    if (!A) return a;
    if (!B) return a;
    return "#" + [0, 1, 2].map(function (i) { return hex2(A[i] * k + B[i] * (1 - k)); }).join("");
  }
  // Text colour that reads on a filled background (WCAG luminance).
  function onColor(bg) {
    var c = rgbOf(bg);
    if (!c) return "#1f2328";
    var l = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#1f2328" : "#ffffff";
  }
  // The outline of a node's shape as a path (ellipse, diamond, hex)
  // or a rect's corner radius (null = draw a rect).
  function shapePath(c) {
    var x = c.x, y = c.y, w = c.w, h = c.h, cx = x + w / 2, cy = y + h / 2;
    if (c.shape === "ellipse") {
      return "M" + r1(x) + " " + r1(cy) + "A" + r1(w / 2) + " " + r1(h / 2) + " 0 1 0 " + r1(x + w) + " " + r1(cy) +
        "A" + r1(w / 2) + " " + r1(h / 2) + " 0 1 0 " + r1(x) + " " + r1(cy) + "Z";
    }
    if (c.shape === "diamond") {
      return "M" + r1(cx) + " " + r1(y) + "L" + r1(x + w) + " " + r1(cy) + "L" + r1(cx) + " " + r1(y + h) + "L" + r1(x) + " " + r1(cy) + "Z";
    }
    if (c.shape === "hex") {
      var s = Math.max(6, c.ex);
      return "M" + r1(x + s) + " " + r1(y) + "L" + r1(x + w - s) + " " + r1(y) + "L" + r1(x + w) + " " + r1(cy) + "L" + r1(x + w - s) + " " + r1(y + h) +
        "L" + r1(x + s) + " " + r1(y + h) + "L" + r1(x) + " " + r1(cy) + "Z";
    }
    return null;
  }
  function radius(c) {
    if (c.shape === "rect") return 2;
    if (c.shape === "round") return Math.min(16, c.h / 2);
    if (c.shape === "pill") return r1(c.h / 2);
    return c.depth === 0 ? 14 : (c.depth === 1 ? 10 : 7);
  }
  // A summary's curly brace from (bx0, by0) to (bx1, by1), tip (tx, ty).
  function bracePath(f) {
    if (f.side === "d") {
      var y = f.by0, xm = f.tx;
      return "M" + r1(f.bx0) + " " + r1(y) + "C" + r1(f.bx0) + " " + r1(y + 10) + " " + r1(xm) + " " + r1(y + 4) + " " + r1(xm) + " " + r1(f.ty) +
        "C" + r1(xm) + " " + r1(y + 4) + " " + r1(f.bx1) + " " + r1(y + 10) + " " + r1(f.bx1) + " " + r1(y);
    }
    var x = f.bx0, ym = f.ty, k = f.side === "l" ? -1 : 1;
    return "M" + r1(x) + " " + r1(f.by0) + "C" + r1(x + 10 * k) + " " + r1(f.by0) + " " + r1(x + 4 * k) + " " + r1(ym) + " " + r1(f.tx) + " " + r1(ym) +
      "C" + r1(x + 4 * k) + " " + r1(ym) + " " + r1(x + 10 * k) + " " + r1(f.by1) + " " + r1(x) + " " + r1(f.by1);
  }

  // opts: { pal, sel, hi{id:1}, drop:{id, mode}, selLink, selFrame,
  //         only{id:1} (presentation: the nodes shown so far),
  //         cur (presentation: the node of this step),
  //         keep{id:1} (presentation: the rest is dimmed) }
  function scene(R, lay, opts) {
    opts = opts || {};
    var pal = opts.pal || THEMES.light, items = [], only = opts.only || null, keep = opts.keep || null;
    function shown(id) { return !only || own(only, id); }
    // boundaries and summaries go under everything else
    (lay.frames || []).forEach(function (f) {
      if (only && !f.nodes.some(shown)) return;
      var col = hex(f.color), on = f.id === opts.selFrame, g = [];
      if (f.kind === "brace") {
        var d = bracePath(f);
        g.push({ tag: "path", cls: "mm-frame-hit", a: { d: d, fill: "none", stroke: "transparent", "stroke-width": 14 } });
        g.push({ tag: "path", cls: "mm-fbox", a: { d: d, fill: "none", stroke: col, "stroke-width": on ? 3 : 2, "stroke-linecap": "round" } });
      } else {
        g.push({ tag: "rect", cls: "mm-fbox", a: { x: f.x, y: f.y, width: f.w, height: f.h, rx: 12, fill: col, "fill-opacity": 0.07,
          stroke: col, "stroke-width": on ? 2.6 : 1.5, "stroke-dasharray": on ? "none" : "7 5" } });
      }
      if (f.label) {
        g.push({ tag: "rect", a: { x: r1(f.lx), y: r1(f.ly), width: f.lw, height: f.lh, rx: 10, fill: col, stroke: col, "stroke-width": 1 } });
        g.push({ tag: "text", a: { x: r1(f.lx + f.lw / 2), y: r1(f.ly + f.lh / 2 + 4), fill: onColor(col), "font-size": FRAME_FONT,
          "font-weight": 700, "text-anchor": "middle" }, text: f.label });
      }
      items.push({ tag: "g", cls: "mm-frame" + (on ? " mm-sel" : ""), a: { "data-frame": f.id }, kids: g });
    });
    lay.edges.forEach(function (e) {
      if (!shown(e.to)) return;
      var a = { d: curve(e), fill: "none", stroke: hex(e.color), "stroke-width": e.depth === 1 ? 3 : (e.depth === 2 ? 2 : 1.5),
                "stroke-linecap": "round" };
      if (e.rec) a["stroke-dasharray"] = "6 5";
      items.push({ tag: "path", cls: "mm-edge" + (keep && !own(keep, e.to) ? " mm-dim" : ""), a: a });
    });
    lay.order.forEach(function (id) {
      if (!shown(id)) return;
      var c = lay.nodes[id], n = R.N[id], sty = c.sty, st = c.st || {};
      var kids = [], root = c.depth === 0, col = root ? pc(pal, "accent") : hex(c.color);
      var bare = c.shape === "line" || c.shape === "none";
      var fill, ink, stroke = col, sw = root ? 2 : (c.depth === 1 ? 2.2 : 1.2), box = {};
      // fill: "" = the classic look (centre solid, others the panel)
      var fk = bare ? "none" : (st.fill || (root ? "solid" : ""));
      if (fk === "solid") { fill = col; ink = root && !st.fill ? pc(pal, "onAccent") : onColor(col); }
      else if (fk === "tint") { fill = mix(col, pc(pal, "panel"), 0.22); ink = pc(pal, "text"); }
      else if (fk === "none") { fill = "transparent"; ink = pc(pal, "text"); }
      else { fill = pc(pal, "panel"); ink = pc(pal, "text"); }
      if (st.border === "thin") sw = 1.2;
      else if (st.border === "thick") sw = 3.5;
      if (bare || st.border === "none") stroke = "none";
      box.fill = fill; box.stroke = stroke; box["stroke-width"] = sw;
      if (!root && !st.border && !st.fill && c.depth > 1) box["stroke-opacity"] = 0.85;
      if (st.border === "dashed" || c.rec) box["stroke-dasharray"] = c.rec ? "5 4" : "6 4";
      var dpath = shapePath(c);
      if (dpath) { box.d = dpath; kids.push({ tag: "path", cls: "mm-box", a: box }); }
      else {
        box.x = c.x; box.y = c.y; box.width = c.w; box.height = c.h; box.rx = radius(c);
        kids.push({ tag: "rect", cls: "mm-box", a: box });
      }
      if (c.shape === "line") {
        kids.push({ tag: "path", a: { d: "M" + c.x + " " + (c.y + c.h - 1) + "L" + (c.x + c.w) + " " + (c.y + c.h - 1),
          fill: "none", stroke: col, "stroke-width": st.border === "thick" ? 4 : (root || c.depth === 1 ? 3 : 2), "stroke-linecap": "round" } });
      }
      var tx = c.x + c.ex + sty.px, ty0 = c.y + c.ey + sty.py;
      var empty = !n.text && !n.emoji;
      if (c.img && R.img && R.img[id]) {
        kids.push({ tag: "image", cls: "mm-img", a: { x: Math.round(c.cx - c.img.w / 2), y: ty0,
          width: c.img.w, height: c.img.h, href: R.img[id].src, preserveAspectRatio: "xMidYMid meet" } });
        ty0 += c.img.h + IMG_GAP;
      }
      var ta = { x: tx, y: ty0 + sty.lh * 0.76, fill: empty ? pc(pal, "dim") : ink,
                 "font-size": sty.font, "font-weight": sty.weight };
      if (n.done) { ta["text-decoration"] = "line-through"; ta.opacity = 0.6; }
      kids.push({ tag: "text", cls: "mm-txt", a: ta, kids: c.lines.map(function (l, i) {
        return { tag: "tspan", a: { x: tx, dy: i ? sty.lh : 0 }, text: l };
      }) });
      if (c.ind) {
        var mark = (n.note ? "≡" : "") + (n.url ? "↗" : "");
        kids.push({ tag: "text", cls: "mm-ind", a: { x: c.x + c.w - c.ex - sty.px + 2, y: ty0 + sty.lh * 0.76,
          fill: fk === "solid" ? ink : pc(pal, "dim"), "font-size": 13, "text-anchor": "end" }, text: mark });
      }
      if (c.folded) {
        var down = c.flow === "d";
        var bx = down ? c.cx : (c.flow === "l" ? c.x - 14 : c.x + c.w + 14), by = down ? c.y + c.h + 14 : c.cy;
        var cnt = c.hidden > 99 ? "99+" : String(c.hidden);
        kids.push({ tag: "g", cls: "mm-fold", a: { "data-fold": id }, kids: [
          { tag: "circle", a: { cx: bx, cy: by, r: 11, fill: pc(pal, "panel"), stroke: col, "stroke-width": 1.6 } },
          { tag: "text", a: { x: bx, y: by + 4, fill: pc(pal, "text"), "font-size": cnt.length > 2 ? 9 : 11,
            "font-weight": 700, "text-anchor": "middle" }, text: cnt }
        ] });
      }
      var cls = "mm-node d" + Math.min(c.depth, 2) + (id === opts.sel ? " mm-sel" : "") +
        (opts.hi && opts.hi[id] ? " mm-hit" : "") + (c.rec ? " mm-rec" : "") + (id === opts.cur ? " mm-cur" : "") +
        (keep && !own(keep, id) ? " mm-dim" : "");
      if (opts.drop && opts.drop.id === id) cls += " mm-drop-" + opts.drop.mode;
      items.push({ tag: "g", cls: cls, a: { "data-id": id }, kids: kids });
    });
    // cross-links on top: dashed curve, arrowhead, label pill
    (lay.links || []).forEach(function (k) {
      if (!shown(k.from) || !shown(k.to)) return;
      var col = k.id === opts.selLink ? pc(pal, "accent") : pc(pal, "dim");
      var d = "M" + r1(k.x1) + " " + r1(k.y1) + "Q" + r1(k.qx) + " " + r1(k.qy) + " " + r1(k.x2) + " " + r1(k.y2);
      var ang = Math.atan2(k.y2 - k.qy, k.x2 - k.qx), a1 = ang + 2.7, a2 = ang - 2.7;
      var head = "M" + r1(k.x2) + " " + r1(k.y2) + "L" + r1(k.x2 + 11 * Math.cos(a1)) + " " + r1(k.y2 + 11 * Math.sin(a1)) +
        "L" + r1(k.x2 + 11 * Math.cos(a2)) + " " + r1(k.y2 + 11 * Math.sin(a2)) + "Z";
      var g = [
        { tag: "path", cls: "mm-link-hit", a: { d: d, fill: "none", stroke: "transparent", "stroke-width": 16 } },
        { tag: "path", a: { d: d, fill: "none", stroke: col, "stroke-width": 1.8, "stroke-dasharray": "6 4",
          "stroke-linecap": "round" } },
        { tag: "path", a: { d: head, fill: col, stroke: col, "stroke-width": 1, "stroke-linejoin": "round" } }
      ];
      if (k.label) {
        g.push({ tag: "rect", a: { x: r1(k.lx - k.lw / 2), y: r1(k.ly - k.lh / 2), width: k.lw, height: k.lh, rx: 10,
          fill: pc(pal, "panel"), stroke: col, "stroke-width": 1 } });
        g.push({ tag: "text", a: { x: r1(k.lx), y: r1(k.ly + 4), fill: pc(pal, "text"), "font-size": LINK_FONT,
          "font-weight": 600, "text-anchor": "middle" }, text: k.label });
      }
      items.push({ tag: "g", cls: "mm-link" + (k.id === opts.selLink ? " mm-sel" : ""), a: { "data-link": k.id }, kids: g });
    });
    return { items: items, w: lay.w, h: lay.h };
  }

  function itemXml(it) {
    if (!own(TAGS, it.tag)) return "";
    var out = "<" + it.tag;
    Object.keys(it.a || {}).forEach(function (k) {
      if (!own(ATTRS, k) || k.indexOf("data-") === 0) return;
      var v = it.a[k];
      if ((k === "fill" || k === "stroke") && !COLOR_RE.test(String(v))) return;
      if (k === "href" && (it.tag !== "image" || !validImg(String(v)))) return;
      out += " " + k + '="' + escXml(v) + '"';
    });
    var inner = it.text !== undefined ? escXml(it.text) : "";
    (it.kids || []).forEach(function (k) { inner += itemXml(k); });
    return out + (inner ? ">" + inner + "</" + it.tag + ">" : "/>");
  }
  // opts: { title, bg (colour or "none") }
  function toSvg(sc, opts) {
    opts = opts || {};
    var w = Math.max(1, Math.round(sc.w)), h = Math.max(1, Math.round(sc.h));
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" font-family="Nunito, \'Segoe UI\', Roboto, Arial, sans-serif">\n';
    if (opts.title) s += "<title>" + escXml(opts.title) + "</title>\n";
    if (opts.bg && opts.bg !== "none" && COLOR_RE.test(opts.bg)) s += '<rect width="' + w + '" height="' + h + '" fill="' + opts.bg + '"/>\n';
    sc.items.forEach(function (it) { s += itemXml(it) + "\n"; });
    return s + "</svg>\n";
  }

  // ---------- 11. Example map ----------
  // Fixed ids: two devices that both press "Example" get ONE map.
  // The texts are a { en, el } table (pack "mindmap"); EXAMPLE_TREE
  // gives the shape: [centre, [[branch, [leaves…]], …]] as keys.
  var EXAMPLE = {
    en: {
      "example.title": "Plan a trip",
      "example.where": "Where", "example.where.1": "Beach or mountains?", "example.where.2": "Budget per day",
      "example.when": "When", "example.when.1": "Dates", "example.when.2": "Book time off",
      "example.packing": "Packing", "example.packing.1": "Clothes", "example.packing.2": "Chargers", "example.packing.3": "Documents",
      "example.tips": "Tips", "example.tips.1": "Tab: add a child", "example.tips.2": "Enter: add a sibling",
      "example.tips.3": "Drag a node onto another to move it"
    },
    el: {
      "example.title": "Σχέδιο ταξιδιού",
      "example.where": "Πού", "example.where.1": "Θάλασσα ή βουνό;", "example.where.2": "Προϋπολογισμός ανά μέρα",
      "example.when": "Πότε", "example.when.1": "Ημερομηνίες", "example.when.2": "Άδεια από τη δουλειά",
      "example.packing": "Βαλίτσα", "example.packing.1": "Ρούχα", "example.packing.2": "Φορτιστές", "example.packing.3": "Έγγραφα",
      "example.tips": "Συμβουλές", "example.tips.1": "Tab: νέο παιδί", "example.tips.2": "Enter: νέος αδελφός",
      "example.tips.3": "Σύρε έναν κόμβο πάνω σε άλλον για να τον μετακινήσεις"
    }
  };
  var EXAMPLE_TREE = ["example.title", [
    ["example.where", ["example.where.1", "example.where.2"]],
    ["example.when", ["example.when.1", "example.when.2"]],
    ["example.packing", ["example.packing.1", "example.packing.2", "example.packing.3"]],
    ["example.tips", ["example.tips.1", "example.tips.2", "example.tips.3"]]]];
  var EXAMPLE_ID = "example1";
  function exampleRows(lang, now) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !EXAMPLE[lang]) I.table(EXAMPLE, "mindmap", lang);
    var tx = EXAMPLE[lang] || EXAMPLE.en, src = EXAMPLE_TREE, nodes = [], k1 = spread(src[1].length);
    nodes.push({ id: rootId(EXAMPLE_ID), m: now, map: EXAMPLE_ID, parent: "", ord: "", text: tx[src[0]] });
    src[1].forEach(function (b, i) {
      var bid = EXAMPLE_ID + "-b" + i, k2 = spread(b[1].length);
      nodes.push({ id: bid, m: now, map: EXAMPLE_ID, parent: rootId(EXAMPLE_ID), ord: k1[i], text: tx[b[0]] });
      b[1].forEach(function (leaf, j) {
        nodes.push({ id: bid + "-" + j, m: now, map: EXAMPLE_ID, parent: bid, ord: k2[j], text: tx[leaf] });
      });
    });
    return { map: normMap({ id: EXAMPLE_ID, m: now, sides: "both" }), nodes: nodes.map(normNode) };
  }

  // ---------- 12. Wave 27: keyboard targets, presentation ----------
  // Where an arrow key goes from node `id` in a laid-out map.
  // Returns { id } (select it), { unfold: id } (open the folded
  // branch first) or null (nothing that way). Each layout kind has
  // its own sense of "out" (towards the children) and of siblings.
  function navTarget(R, lay, id, dir) {
    var L = lay.nodes, rid = R.root.id, c = L[id];
    if (!c) return { id: rid };
    var kind = lay.kind || "";
    function kidsOf(x) { return L[x] ? L[x].kids : []; }
    function nearest(list, key, v) {
      var best = null, d = Infinity;
      list.forEach(function (x) { var dd = Math.abs(L[x][key] - v); if (dd < d) { d = dd; best = x; } });
      return best;
    }
    function out(key, v) {
      if (c.folded) return { unfold: id };
      var k = kidsOf(id);
      return k.length ? { id: key ? nearest(k, key, v) : k[0] } : null;
    }
    function to(x) { return x ? { id: x } : null; }
    function sibs(key) {
      return kidsOf(R.par[id]).slice().sort(function (a, b) { return L[a][key] - L[b][key] || cmpStr(a, b); });
    }
    if (!kind) {
      if (dir === "left" || dir === "right") {
        if (c.depth === 0) {
          return to(nearest(kidsOf(id).filter(function (x) { return L[x].side === (dir === "right" ? "r" : "l"); }), "cy", c.cy));
        }
        if ((dir === "right") === (c.side !== "l")) return out("cy", c.cy);     // away from the centre
        return to(R.par[id]);
      }
      if (c.depth === 0) return null;
      var vs = sibs("cy").filter(function (x) { return L[x].side === c.side; });
      return to(vs[vs.indexOf(id) + (dir === "down" ? 1 : -1)]);
    }
    if (kind === "org") {
      if (dir === "down") return out("cx", c.cx);
      if (dir === "up") return id === rid ? null : to(R.par[id]);
      if (id === rid) return null;
      var hs = sibs("cx");
      return to(hs[hs.indexOf(id) + (dir === "right" ? 1 : -1)]);
    }
    if (kind === "time" && c.depth <= 1) {
      if (c.depth === 0) return dir === "right" ? to(kidsOf(rid)[0]) : null;
      var mains = kidsOf(rid), i = mains.indexOf(id);
      if (dir === "left") return to(i > 0 ? mains[i - 1] : rid);
      if (dir === "right") return to(mains[i + 1]);
      if (dir === "down") return out(null);
      return null;
    }
    // rows of a tree (the whole tree, or one main branch of a timeline)
    if (dir === "right") return out(null);
    if (dir === "left") return id === rid ? null : to(R.par[id]);
    var scope = kind === "time" ? branchOf(R, id) : rid, rows = [], st = [scope];
    while (st.length) {
      var x = st.pop();
      rows.push(x);
      var k = kidsOf(x);
      for (var j = k.length - 1; j >= 0; j--) st.push(k[j]);
    }
    rows.sort(function (a, b) { return L[a].y - L[b].y || cmpStr(a, b); });
    return to(rows[rows.indexOf(id) + (dir === "down" ? 1 : -1)]);
  }

  // Presentation: the order the nodes appear in, one per step (the
  // centre first, then each branch top to bottom, depth first). A
  // folded branch is one step: its node, not what is folded inside.
  function presentSteps(R, fold) {
    fold = fold || {};
    var out = [], rid = R.root.id, stack = [rid];
    while (stack.length && out.length <= MAX_NODES) {
      var id = stack.pop();
      out.push(id);
      if (id !== rid && own(fold, id)) continue;
      var k = R.kids[id] || [];
      for (var i = k.length - 1; i >= 0; i--) stack.push(k[i]);
    }
    return out;
  }
  // What the camera shows at step i (i = steps.length: the whole map):
  // the centre alone at first, then the WHOLE main branch of the step's
  // node, so the view stays still while that branch unfolds.
  // → { x, y, w, h } in drawing coordinates.
  function presentView(R, lay, steps, i) {
    var P = 24;
    if (i >= steps.length || !steps.length) return { x: 0, y: 0, w: lay.w, h: lay.h };
    var id = steps[i], rid = R.root.id, L = lay.nodes;
    if (id === rid || !L[id]) { var c0 = L[rid]; return { x: c0.x - P * 4, y: c0.y - P * 3, w: c0.w + P * 8, h: c0.h + P * 6 }; }
    var main = branchOf(R, id) || id, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, st = [main];
    while (st.length) {
      var x = st.pop(), c = L[x];
      if (!c) continue;
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
      for (var j = 0; j < c.kids.length; j++) st.push(c.kids[j]);
    }
    (lay.frames || []).forEach(function (f) {
      if (f.nodes.indexOf(main) === -1) return;
      x0 = Math.min(x0, f.x, f.lx); y0 = Math.min(y0, f.y, f.ly);
      x1 = Math.max(x1, f.x + f.w, f.lx + f.lw); y1 = Math.max(y1, f.y + f.h);
    });
    return { x: x0 - P, y: y0 - P, w: x1 - x0 + 2 * P, h: y1 - y0 + 2 * P };
  }

  // ---------- 13. orOS file (.orosmind, bundle.js) ----------
  // One map = one bundle. content.json is
  //   { kind: "oros-mindmap-package", ver: 1, map: <map id>,
  //     data: <exportData of that one map> }
  // except that each picture's data URI leaves its imgs row for
  // media/<sha256>.<ext>: the row keeps every other field and says
  // src: "", media: "<key>". DOM-free: sha256 comes in as `hash`
  // (bytes → Promise<hex>), base64 is atob/btoa (browser and Node).
  var PKG_KIND = "oros-mindmap-package", PKG_VER = 1;
  var PIC_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  function b64Bytes(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesB64(u) {
    var s = "";
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // → Promise<{ content, media { key: bytes }, title, created, modified,
  //   outline (Markdown), opml }>; null when the map is not there.
  function packBundle(data, mapId, hash, nowIso) {
    var obj = JSON.parse(exportData(data, mapId, nowIso));
    if (!obj.maps.length) return Promise.resolve(null);
    var media = dict(), jobs = [];
    obj.imgs.forEach(function (row) {
      var m = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(row.src || "");
      if (!m) { row.src = ""; return; }
      var bytes = b64Bytes(m[2]);
      jobs.push(hash(bytes).then(function (h) {
        var key = h + "." + PIC_EXT[m[1]];
        media[key] = bytes;
        row.src = "";
        row.media = key;
      }));
    });
    var R = resolve(obj, mapId), lo = Infinity, hi = 0;
    obj.nodes.forEach(function (n) { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); });
    obj.maps.forEach(function (mp) { lo = Math.min(lo, mp.m); hi = Math.max(hi, mp.m); });
    return Promise.all(jobs).then(function () {
      return {
        content: { kind: PKG_KIND, ver: PKG_VER, map: mapId, data: obj },
        media: media,
        title: title(R.root.text, 200),
        created: lo === Infinity ? 0 : lo, modified: hi,
        outline: toOutline(R),
        opml: toOpml(R, null, nowIso)
      };
    });
  }
  // A bundle's content + media → rows for NEW maps: fresh map, node,
  // link and frame ids, m = now, every row through parseImport's
  // normalisers (the same as a JSON import). media: { key: { bytes,
  // type } } (bundle.js read result). newId() → a fresh id.
  // → { ok: true, data, map (first new map id), stats } or
  //   { ok: false, err: "format" | "size" | "json" | "toolarge" | "empty" }
  function unpackBundle(content, media, newId, now) {
    if (!content || typeof content !== "object" || content.kind !== PKG_KIND ||
        !content.data || typeof content.data !== "object") return { ok: false, err: "format" };
    var raw = content.data;
    media = media || {};
    if (Array.isArray(raw.imgs)) raw.imgs = raw.imgs.map(function (row) {
      if (!row || typeof row !== "object") return row;
      var key = typeof row.media === "string" ? row.media : "", f = key && own(media, key) ? media[key] : null;
      var c = {};
      Object.keys(row).forEach(function (k) { if (k !== "media") c[k] = row[k]; });
      if (f && f.bytes && own(PIC_EXT, f.type)) c.src = "data:" + f.type + ";base64," + bytesB64(f.bytes);
      return c;
    });
    raw.tombs = {};
    var r;
    try { r = parseImport(JSON.stringify(raw), null); } catch (e) { return { ok: false, err: "format" }; }
    if (!r.ok) return r;
    var d = r.data;
    if (!d.maps.length) return { ok: false, err: "empty" };
    var mapOf = dict(), idOf = dict(), out = emptyData();
    d.maps.forEach(function (mp) {
      var nid = newId();
      mapOf[mp.id] = nid;
      idOf[rootId(mp.id)] = rootId(nid);
      out.maps.push({ id: nid, m: now, sides: mp.sides });
    });
    d.nodes.forEach(function (n) { if (!own(idOf, n.id)) idOf[n.id] = newId(); });
    d.nodes.forEach(function (n) {
      var c = {};
      Object.keys(n).forEach(function (k) { c[k] = n[k]; });
      c.id = idOf[n.id]; c.map = mapOf[n.map]; c.m = now;
      c.parent = n.parent && own(idOf, n.parent) ? idOf[n.parent] : "";
      out.nodes.push(c);
    });
    // a map whose centre was missing gets an empty one (as duplicate does)
    d.maps.forEach(function (mp) {
      var rid = rootId(mapOf[mp.id]);
      if (!out.nodes.some(function (n) { return n.id === rid; }))
        out.nodes.push(normNode({ id: rid, m: now, map: mapOf[mp.id], parent: "", text: "" }));
    });
    function same(x) { return own(idOf, x.id) && own(mapOf, x.map); }
    function moved(x, extra) {
      var c = {};
      Object.keys(x).forEach(function (k) { c[k] = x[k]; });
      c.m = now; c.map = mapOf[x.map];
      Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
      return c;
    }
    d.links.forEach(function (l) {
      if (own(mapOf, l.map) && own(idOf, l.from) && own(idOf, l.to))
        out.links.push(moved(l, { id: newId(), from: idOf[l.from], to: idOf[l.to] }));
    });
    d.pos.forEach(function (x) { if (same(x)) out.pos.push(moved(x, { id: idOf[x.id] })); });
    d.imgs.forEach(function (x) { if (same(x) && x.src) out.imgs.push(moved(x, { id: idOf[x.id] })); });
    d.styles.forEach(function (x) { if (same(x)) out.styles.push(moved(x, { id: idOf[x.id] })); });
    d.frames.forEach(function (f) {
      if (!own(mapOf, f.map)) return;
      var ids = f.nodes.filter(function (x) { return own(idOf, x); }).map(function (x) { return idOf[x]; });
      var row = normFrame(moved(f, { id: newId(), nodes: ids }));
      if (row) out.frames.push(row);
    });
    d.layouts.forEach(function (x) {
      if (own(mapOf, x.id)) out.layouts.push({ id: mapOf[x.id], m: now, map: mapOf[x.id], kind: x.kind });
    });
    // the first map of the file (content.map when it names one)
    var first = own(mapOf, content.map) ? mapOf[content.map] : out.maps[0].id;
    return { ok: true, data: out, map: first, stats: r.stats };
  }

  var api = {
    PKG_KIND: PKG_KIND, packBundle: packBundle, unpackBundle: unpackBundle,
    VER: VER, FORMAT: FORMAT, TEXT_LEN: TEXT_LEN, NOTE_LEN: NOTE_LEN, URL_LEN: URL_LEN, MAX_NODES: MAX_NODES,
    IMPORT_MAX: IMPORT_MAX, COLORS: COLORS, COLOR_KEYS: COLOR_KEYS, AUTO: AUTO, SIDES: SIDES, THEMES: THEMES,
    TAGS: TAGS, ATTRS: ATTRS, COLOR_RE: COLOR_RE, EXAMPLE_ID: EXAMPLE_ID,
    isId: isId, isMapId: isMapId, rootId: rootId, line: line, para: para, emoji: emoji, validUrl: validUrl,
    cleanUrl: cleanUrl, title: title,
    between: between, spread: spread, validOrd: validOrd, placeAt: placeAt,
    normMap: normMap, normNode: normNode, normLink: normLink, normPos: normPos, normImg: normImg,
    validImg: validImg, emptyData: emptyData, merge: merge,
    LABEL_LEN: LABEL_LEN, MAX_LINKS: MAX_LINKS, MAX_OFF: MAX_OFF, IMG_LEN: IMG_LEN, IMG_TOTAL: IMG_TOTAL, IMG_MAX: IMG_MAX,
    resolve: resolve, subtree: subtree, depthOf: depthOf, isInside: isInside, branchOf: branchOf,
    exportData: exportData, parseImport: parseImport,
    parseOutline: parseOutline, toOutline: toOutline, readXml: readXml, parseOpml: parseOpml, toOpml: toOpml,
    treeToRows: treeToRows, topsOf: topsOf,
    wrap: wrap, estimate: estimate, layout: layout, scene: scene, toSvg: toSvg, escXml: escXml,
    exampleRows: exampleRows,
    SHAPES: SHAPES, FILLS: FILLS, BORDERS: BORDERS, SIZES: SIZES, FRAME_KINDS: FRAME_KINDS, LAYOUTS: LAYOUTS,
    MAX_FRAMES: MAX_FRAMES, FRAME_NODES: FRAME_NODES,
    normStyle: normStyle, normFrame: normFrame, normLayout: normLayout, plainStyle: plainStyle,
    onColor: onColor, mix: mix, navTarget: navTarget, presentSteps: presentSteps, presentView: presentView
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMCore = api;
})(this);
