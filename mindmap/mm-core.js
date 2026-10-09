// ============================================================
// orOS Mind Map — core (v1.0.0)
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
// Data MINDMAP v1 (oros-mindmap-data):
//   { ver: 1,
//     maps:  [{ id, m, sides }],
//     nodes: [{ id, m, map, parent, ord, text, emoji, color,
//               note, url, done }],
//     tombs: { id: deletedAt } }
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
  var URL_RE = /^https?:\/\/[^\s<>"'`\\]+$/i;

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

  function normTombs(t, into) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return into;
    Object.keys(t).forEach(function (id) {
      if (!isId(id) || !isTs(t[id])) return;
      if (!own(into, id) || t[id] > into[id]) into[id] = t[id];
    });
    return into;
  }

  function emptyData() { return { ver: VER, maps: [], nodes: [], tombs: {} }; }

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
    var sorted = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sorted[id] = tombs[id]; });
    return { ver: VER, maps: maps, nodes: nodes, tombs: sorted };
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
    return { map: map, root: rootNode, N: N, kids: kids, par: par, rec: rec, count: ids.length + 1 };
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
      out.maps = d.maps.filter(function (mp) { return mp.id === mapId; });
      out.nodes = d.nodes.filter(function (n) { return n.map === mapId; });
      out.tombs = {};
    } else {
      out.maps = d.maps; out.nodes = d.nodes; out.tombs = d.tombs;
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
    var d = merge({ maps: maps, nodes: nodes, tombs: normTombs(raw.tombs, dict()) }, {});
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
      if (/^\s*```/.test(raw)) { inFence = !inFence; return; }
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
  // Returns { map (or null), nodes[] }.
  function topsOf(tree) { return tree.fallback ? tree.kids : [tree]; }
  function treeToRows(tree, newId, now, under) {
    var nodes = [], mapRow = null, rootRowId, mapId, tops, keys0;
    if (under) { mapId = under.map; tops = topsOf(tree); keys0 = under.keys; }
    else {
      mapId = newId();
      mapRow = { id: mapId, m: now, sides: "both" };
      rootRowId = rootId(mapId);
      nodes.push({ id: rootRowId, m: now, map: mapId, parent: "", ord: "", text: tree.text,
                   emoji: "", color: "", note: tree.note || "", url: "", done: !!tree.done });
      tops = tree.kids;
      keys0 = spread(tops.length);
    }
    var stack = [];
    for (var i = tops.length - 1; i >= 0; i--) stack.push([tops[i], under ? under.parent : rootRowId, keys0[i]]);
    while (stack.length && nodes.length < MAX_NODES) {
      var e = stack.pop(), t = e[0], id = newId();
      nodes.push({ id: id, m: now, map: mapId, parent: e[1], ord: e[2], text: t.text, emoji: "",
                   color: "", note: t.note || "", url: "", done: !!t.done });
      var ks = spread(t.kids.length);
      for (var j = t.kids.length - 1; j >= 0; j--) stack.push([t.kids[j], id, ks[j]]);
    }
    return { map: mapRow, nodes: nodes.map(normNode).filter(Boolean) };
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

  // opts: { measure, fold{id:1}, placeholder, margin }
  // → { nodes{id:{id,x,y,w,h,cx,cy,depth,side,lines,sty,color,folded,
  //            hidden,rec,ind}}, order[], edges[], w, h }
  function layout(R, opts) {
    opts = opts || {};
    var measure = opts.measure || estimate, fold = opts.fold || {}, M = opts.margin === undefined ? 40 : opts.margin;
    var rid = R.root.id, L = dict(), order = [];
    var sides = R.map && R.map.sides === "right" ? "right" : "both";
    var top = R.kids[rid] || [];
    var rightN = sides === "right" ? top.length : Math.ceil(top.length / 2);

    // 1. visible nodes, depth, side, size (pre-order, iterative)
    var stack = [[rid, 0, 0, null]];
    while (stack.length) {
      var e = stack.pop(), id = e[0], depth = e[1], n = R.N[id];
      var sty = styleAt(depth);
      var txt = (n.emoji ? n.emoji + " " : "") + (n.text || (id === rid ? (opts.placeholder || "") : "…"));
      var lines = wrap(txt, sty, measure), wmax = 0;
      lines.forEach(function (l) { wmax = Math.max(wmax, measure(l, sty.font, sty.weight)); });
      var ind = (n.note ? 1 : 0) + (n.url ? 1 : 0);
      var kids = R.kids[id] || [];
      var isFold = kids.length > 0 && id !== rid && own(fold, id);
      var color;
      if (depth === 0) color = "";
      else if (depth === 1) color = n.color || AUTO[e[2] % AUTO.length];
      else color = n.color || e[3];
      var side = depth === 0 ? "c" : (depth === 1 ? (e[2] < rightN ? "r" : "l") : e[4]);
      L[id] = {
        id: id, depth: depth, side: side, lines: lines, sty: sty, color: color,
        w: Math.ceil(Math.max(wmax, 24) + sty.px * 2 + ind * 16), h: lines.length * sty.lh + sty.py * 2,
        folded: isFold, hidden: 0, rec: !!R.rec[id], ind: ind, kids: []
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

    // 2. block heights, bottom-up
    var blk = dict();
    for (var o = order.length - 1; o >= 0; o--) {
      var nd = L[order[o]];
      if (nd.depth === 0) continue;
      var sum = 0, kk = nd.kids, gap = VGAP[Math.min(nd.depth + 1, 2)];
      for (var q = 0; q < kk.length; q++) sum += blk[kk[q]] + (q ? gap : 0);
      blk[nd.id] = Math.max(nd.h, sum);
    }

    // 3. positions, top-down
    var R0 = L[rid];
    R0.x = -R0.w / 2; R0.y = -R0.h / 2;
    var right = R0.kids.filter(function (id) { return L[id].side === "r"; });
    var left = R0.kids.filter(function (id) { return L[id].side === "l"; }).reverse();   // clockwise
    function place(list, parent) {
      var gap = VGAP[Math.min(parent.depth + 1, 2)], total = 0;
      list.forEach(function (id, i) { total += blk[id] + (i ? gap : 0); });
      var y = parent.y + parent.h / 2 - total / 2;
      list.forEach(function (id) {
        var c = L[id], hg = HGAP[Math.min(parent.depth, 2)];
        c.y = y + blk[id] / 2 - c.h / 2;
        c.x = c.side === "l" ? parent.x - hg - c.w : parent.x + parent.w + hg;
        y += blk[id] + gap;
      });
    }
    place(right, R0);
    place(left, R0);
    for (var z = 0; z < order.length; z++) {
      var pn = L[order[z]];
      if (pn.depth === 0 || !pn.kids.length) continue;
      place(pn.side === "l" ? pn.kids.slice() : pn.kids, pn);
    }

    // 4. bounds → shift so the drawing starts at (M, M)
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    order.forEach(function (id) {
      var c = L[id], extra = c.folded ? 26 : 0;
      minX = Math.min(minX, c.x - (c.side === "l" ? extra : 0));
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w + (c.side !== "l" ? extra : 0));
      maxY = Math.max(maxY, c.y + c.h);
    });
    var dx = M - minX, dy = M - minY;
    order.forEach(function (id) {
      var c = L[id];
      c.x = Math.round(c.x + dx); c.y = Math.round(c.y + dy);
      c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2;
    });
    var edges = [];
    order.forEach(function (id) {
      if (id === rid) return;
      var c = L[id], p = L[R.par[id]];
      var x1 = c.side === "l" ? p.x : p.x + p.w, x2 = c.side === "l" ? c.x + c.w : c.x;
      if (p.depth === 0) x1 = p.cx + (c.side === "l" ? -1 : 1) * p.w * 0.3;
      edges.push({ from: p.id, to: id, x1: x1, y1: p.cy, x2: x2, y2: c.cy, color: c.color, depth: c.depth, rec: c.rec });
    });
    return { nodes: L, order: order, edges: edges, w: Math.ceil(maxX - minX + 2 * M), h: Math.ceil(maxY - minY + 2 * M) };
  }

  // ---------- 10. Scene + SVG ----------
  // One list of drawing items for both the live SVG (DOM, built with
  // createElementNS + textContent) and the exported file (string,
  // every attribute escaped). Colours come from `pal`, validated.
  var TAGS = { g: 1, rect: 1, path: 1, text: 1, tspan: 1, circle: 1, title: 1 };
  var ATTRS = { x: 1, y: 1, dy: 1, width: 1, height: 1, rx: 1, d: 1, cx: 1, cy: 1, r: 1,
                fill: 1, stroke: 1, "stroke-width": 1, "stroke-dasharray": 1, "fill-opacity": 1,
                "stroke-opacity": 1, opacity: 1, "font-size": 1, "font-weight": 1, "text-anchor": 1,
                "text-decoration": 1, "data-id": 1, "data-fold": 1, "stroke-linecap": 1 };
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
    var mx = (e.x1 + e.x2) / 2;
    return "M" + r1(e.x1) + " " + r1(e.y1) + "C" + r1(mx) + " " + r1(e.y1) + " " + r1(mx) + " " + r1(e.y2) +
      " " + r1(e.x2) + " " + r1(e.y2);
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  // opts: { pal, sel, hi{id:1}, drop:{id, mode} }
  function scene(R, lay, opts) {
    opts = opts || {};
    var pal = opts.pal || THEMES.light, items = [];
    lay.edges.forEach(function (e) {
      var a = { d: curve(e), fill: "none", stroke: hex(e.color), "stroke-width": e.depth === 1 ? 3 : (e.depth === 2 ? 2 : 1.5),
                "stroke-linecap": "round" };
      if (e.rec) a["stroke-dasharray"] = "6 5";
      items.push({ tag: "path", cls: "mm-edge", a: a });
    });
    lay.order.forEach(function (id) {
      var c = lay.nodes[id], n = R.N[id], sty = c.sty;
      var kids = [], root = c.depth === 0, col = root ? pc(pal, "accent") : hex(c.color);
      var box = { x: c.x, y: c.y, width: c.w, height: c.h, rx: root ? 14 : (c.depth === 1 ? 10 : 7) };
      if (root) { box.fill = col; box.stroke = col; box["stroke-width"] = 2; }
      else if (c.depth === 1) { box.fill = pc(pal, "panel"); box.stroke = col; box["stroke-width"] = 2.2; }
      else { box.fill = pc(pal, "panel"); box.stroke = col; box["stroke-width"] = 1.2; box["stroke-opacity"] = 0.85; }
      if (c.rec) box["stroke-dasharray"] = "5 4";
      kids.push({ tag: "rect", cls: "mm-box", a: box });
      var tx = c.x + sty.px, fill = root ? pc(pal, "onAccent") : pc(pal, "text");
      var empty = !n.text && !n.emoji;
      var ta = { x: tx, y: c.y + sty.py + sty.lh * 0.76, fill: empty ? pc(pal, "dim") : fill,
                 "font-size": sty.font, "font-weight": sty.weight };
      if (n.done) { ta["text-decoration"] = "line-through"; ta.opacity = 0.6; }
      kids.push({ tag: "text", cls: "mm-txt", a: ta, kids: c.lines.map(function (l, i) {
        return { tag: "tspan", a: { x: tx, dy: i ? sty.lh : 0 }, text: l };
      }) });
      if (c.ind) {
        var mark = (n.note ? "≡" : "") + (n.url ? "↗" : "");
        kids.push({ tag: "text", cls: "mm-ind", a: { x: c.x + c.w - sty.px + 2, y: c.y + sty.py + sty.lh * 0.76,
          fill: root ? fill : pc(pal, "dim"), "font-size": 13, "text-anchor": "end" }, text: mark });
      }
      if (c.folded) {
        var bx = c.side === "l" ? c.x - 14 : c.x + c.w + 14, cnt = c.hidden > 99 ? "99+" : String(c.hidden);
        kids.push({ tag: "g", cls: "mm-fold", a: { "data-fold": id }, kids: [
          { tag: "circle", a: { cx: bx, cy: c.cy, r: 11, fill: pc(pal, "panel"), stroke: col, "stroke-width": 1.6 } },
          { tag: "text", a: { x: bx, y: c.cy + 4, fill: pc(pal, "text"), "font-size": cnt.length > 2 ? 9 : 11,
            "font-weight": 700, "text-anchor": "middle" }, text: cnt }
        ] });
      }
      var cls = "mm-node d" + Math.min(c.depth, 2) + (id === opts.sel ? " mm-sel" : "") +
        (opts.hi && opts.hi[id] ? " mm-hit" : "") + (c.rec ? " mm-rec" : "");
      if (opts.drop && opts.drop.id === id) cls += " mm-drop-" + opts.drop.mode;
      items.push({ tag: "g", cls: cls, a: { "data-id": id }, kids: kids });
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
  var EXAMPLE = {
    en: ["Plan a trip", [["Where", ["Beach or mountains?", "Budget per day"]], ["When", ["Dates", "Book time off"]],
         ["Packing", ["Clothes", "Chargers", "Documents"]], ["Tips", ["Tab: add a child", "Enter: add a sibling",
         "Drag a node onto another to move it"]]]],
    el: ["Σχέδιο ταξιδιού", [["Πού", ["Θάλασσα ή βουνό;", "Προϋπολογισμός ανά μέρα"]], ["Πότε", ["Ημερομηνίες", "Άδεια από τη δουλειά"]],
         ["Βαλίτσα", ["Ρούχα", "Φορτιστές", "Έγγραφα"]], ["Συμβουλές", ["Tab: νέο παιδί", "Enter: νέος αδελφός",
         "Σύρε έναν κόμβο πάνω σε άλλον για να τον μετακινήσεις"]]]]
  };
  var EXAMPLE_ID = "example1";
  function exampleRows(lang, now) {
    var src = EXAMPLE[lang === "el" ? "el" : "en"], nodes = [], k1 = spread(src[1].length);
    nodes.push({ id: rootId(EXAMPLE_ID), m: now, map: EXAMPLE_ID, parent: "", ord: "", text: src[0] });
    src[1].forEach(function (b, i) {
      var bid = EXAMPLE_ID + "-b" + i, k2 = spread(b[1].length);
      nodes.push({ id: bid, m: now, map: EXAMPLE_ID, parent: rootId(EXAMPLE_ID), ord: k1[i], text: b[0] });
      b[1].forEach(function (leaf, j) {
        nodes.push({ id: bid + "-" + j, m: now, map: EXAMPLE_ID, parent: bid, ord: k2[j], text: leaf });
      });
    });
    return { map: normMap({ id: EXAMPLE_ID, m: now, sides: "both" }), nodes: nodes.map(normNode) };
  }

  var api = {
    VER: VER, FORMAT: FORMAT, TEXT_LEN: TEXT_LEN, NOTE_LEN: NOTE_LEN, URL_LEN: URL_LEN, MAX_NODES: MAX_NODES,
    IMPORT_MAX: IMPORT_MAX, COLORS: COLORS, COLOR_KEYS: COLOR_KEYS, AUTO: AUTO, SIDES: SIDES, THEMES: THEMES,
    TAGS: TAGS, ATTRS: ATTRS, COLOR_RE: COLOR_RE, EXAMPLE_ID: EXAMPLE_ID,
    isId: isId, isMapId: isMapId, rootId: rootId, line: line, para: para, emoji: emoji, validUrl: validUrl,
    cleanUrl: cleanUrl, title: title,
    between: between, spread: spread, validOrd: validOrd, placeAt: placeAt,
    normMap: normMap, normNode: normNode, emptyData: emptyData, merge: merge,
    resolve: resolve, subtree: subtree, depthOf: depthOf, isInside: isInside, branchOf: branchOf,
    exportData: exportData, parseImport: parseImport,
    parseOutline: parseOutline, toOutline: toOutline, readXml: readXml, parseOpml: parseOpml, toOpml: toOpml,
    treeToRows: treeToRows, topsOf: topsOf,
    wrap: wrap, estimate: estimate, layout: layout, scene: scene, toSvg: toSvg, escXml: escXml,
    exampleRows: exampleRows
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MMCore = api;
})(this);
