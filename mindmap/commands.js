// ============================================================
// orOS Mind Map — commands.js: what the Assistant may change in a
// map (AS-EDIT, wave MM1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Mind map, in
// the step format of the automations (recipes/core.js specs; field
// names as in the other catalogs where they mean the same). The same
// file runs in two places:
//   - in the Assistant, to check a command list, find the maps it is
//     for (targets), count what it would change on a copy (preview)
//     and describe a map to the AI (outline, with the user's consent);
//   - in Mind map (assist.js), which applies it and saves the result
//     as new edits of the map, so it syncs like any other change.
// Every row is built with MMCore's own normalisers and stamped above
// its old stamp and any tombstone, as the app's put*() and nextM() do;
// new ideas take order keys from MMCore.placeAt / between, so two
// devices adding at once both keep theirs. Ideas are picked with:
//   ids     idea ids from read_in_app (comma separated)
//   has     words in an idea's text
//   branch  an idea (id or words): it and everything under it
//   level   1 = the main branches, 2 = theirs, …
// The map's title is the text of its centre (id "<map>-r").
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more (add, link and frame make new rows each
// time).
// Pure: no DOM. Needs recipes/core.js and mindmap/mm-core.js (MMCore).
// Exposes window.MindmapCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var M = node ? require("./mm-core.js") : root.MMCore;
  if (!R || !M) return;

  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  var NODESIZE = ["", "s", "m", "l"];        // m = the normal size ("" in the data)
  var SEL = { ids: { t: "str", max: 2000 }, has: { t: "str", max: 200 }, branch: { t: "str", max: 200 }, level: { t: "int", lo: 1, hi: 100, def: null } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }

  // kind: "doc" (every command edits a map)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 500 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 2000, req: 1 } }) },
    add: { kind: "doc", args: { text: { t: "str", max: 20000, req: 1 }, to: { t: "str", max: 200 }, c: { t: "color" }, emoji: { t: "str", max: 16 }, note: { t: "str", max: 10000 } } },
    node: { kind: "doc", args: sel({ c: { t: "color" }, emoji: { t: "str", max: 16 }, note: { t: "str", max: 10000 }, url: { t: "str", max: 2000 }, done: ONOFF,
      shape: oneOf([""].concat(M.SHAPES.filter(Boolean))), fill: oneOf([""].concat(M.FILLS.filter(Boolean))), border: oneOf([""].concat(M.BORDERS.filter(Boolean))),
      nodesize: oneOf(NODESIZE), bold: ONOFF }) },
    move: { kind: "doc", args: sel({ to: { t: "str", max: 200, req: 1 } }) },
    sort: { kind: "doc", args: sel({ desc: { t: "bool" } }) },
    link: { kind: "doc", args: { from: { t: "str", max: 200, req: 1 }, to: { t: "str", max: 200, req: 1 }, text: { t: "str", max: 200 } } },
    frame: { kind: "doc", args: sel({ kind: oneOf(M.FRAME_KINDS), text: { t: "str", max: 200 }, c: { t: "color" } }) },
    remove: { kind: "doc", args: sel({}) },
    map: { kind: "doc", args: { layout: oneOf(["", "map", "org", "tree", "time"]), sides: oneOf(["", "both", "right"]) } },
    rename: { kind: "doc", args: { title: { t: "str", max: 2000, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  var COLOR_LIST = M.COLOR_KEYS.map(function (k) { return k + " " + M.COLORS[k]; }).join(", ");
  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Mind map commands (documents are maps; the map's title is the text of its centre; ideas are picked with ids (idea ids from read_in_app, comma separated), has (words in an idea's text), " +
    "branch (an idea's id or words: it and everything under it) and level (1 = the main branches around the centre, 2 = theirs, …); `to`, `from` and `branch` name one idea by id or by words of its text (the centre by the map's title); " +
    "colours are given as #rrggbb and snap to the map's branch colours (" + COLOR_LIST + "); null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in the text of the picked ideas (cs = match case, word = whole words)",
    "settext: the text of the picked ideas becomes `text`",
    "add: new ideas under the idea `to` (default: the centre), at the end; `text` is one idea, or several lines (a Markdown list or indented lines make ideas with ideas under them); c, emoji and note go on each new top idea",
    "node: for the picked ideas c (branch colour), emoji (one emoji, \"none\" removes it), note (a longer text shown with the idea, \"none\" removes it), url (a web link, \"none\" removes it), done on|off (a task tick), " +
      "shape " + M.SHAPES.filter(Boolean).join("|") + ", fill " + M.FILLS.filter(Boolean).join("|") + ", border " + M.BORDERS.filter(Boolean).join("|") + ", nodesize s|m|l, bold on|off",
    "move: the picked ideas (with what is under them) go under the idea `to`, at the end",
    "sort: the ideas under each picked idea (default: the centre) in A-Z order (desc = Z-A)",
    "link: a cross-link from the idea `from` to the idea `to`, labelled `text`",
    "frame: a boundary (kind box) or a summary brace (kind brace) around the picked ideas, labelled `text`, colour c (at most 50 ideas)",
    "remove: delete the picked ideas with everything under them (needs ids, has, branch or level; never the centre)",
    "map: layout map (around the centre)|org (org chart)|tree (a list going down)|time (a timeline); sides both|right (where a map's branches go)",
    "rename: the map's title (its centre's text) becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var IDS_RX = /^[\s,A-Za-z0-9_-]*$/;
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function picks(st) { return given(st.ids) || given(st.has) || given(st.branch) || given(st.level); }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          (spec.t === "color" && raw[k] !== "" && !v) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.ids === "string" && !IDS_RX.test(raw.ids)) bad.push("ids must be idea ids from read_in_app, comma separated");
    if (typeof raw.url === "string" && raw.url && raw.url !== "none" && !M.validUrl(raw.url.trim())) bad.push("url must start with http:// or https://");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (st.op === "remove" && !picks(st)) return { err: "remove: pick the ideas with ids, has, branch or level" };
    if (st.op === "frame" && !picks(st)) return { err: "frame: pick the ideas with ids, has, branch or level" };
    if (st.op === "node" && !st.c && !given(st.emoji) && !given(st.note) && !given(st.url) && !st.done && !st.shape && !st.fill && !st.border && !st.nodesize && !st.bold) {
      return { err: "node: give c, emoji, note, url, done, shape, fill, border, nodesize or bold" };
    }
    if (st.op === "map" && !st.layout && !st.sides) return { err: "map: give layout or sides" };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, k) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (k + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. A map as the commands see it ----------
  var LISTS = ["maps", "nodes", "links", "pos", "imgs", "styles", "frames", "layouts"];
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function mapOf(key, x) { return key === "maps" ? x.id : x.map; }
  // { mid, data } where data holds that one map's rows (MMCore's merge
  // and resolve work on it as on the whole).
  function work(d, mid) {
    var part = { ver: M.VER, tombs: copy(d.tombs || {}) };
    LISTS.forEach(function (key) { part[key] = (d[key] || []).filter(function (x) { return mapOf(key, x) === mid; }).map(copy); });
    return { mid: mid, data: M.merge(part, {}) };
  }
  function tree(w) { return M.resolve(w.data, w.mid); }
  function stampFor(w, key, id, now) {
    var old = null;
    w.data[key].forEach(function (x) { if (x.id === id) old = x; });
    return Math.max(now, old ? old.m + 1 : 0, own(w.data.tombs, id) ? w.data.tombs[id] + 1 : 0);
  }
  // A row written as the app's put*() writes it: normalised, newer.
  var NORM = { maps: M.normMap, nodes: M.normNode, links: M.normLink, pos: M.normPos, imgs: M.normImg, styles: M.normStyle, frames: M.normFrame, layouts: M.normLayout };
  function put(w, key, row, now) {
    row = Object.assign({}, row, { m: stampFor(w, key, row.id, now) });
    var x = NORM[key](row);
    if (!x) return null;
    w.data[key] = w.data[key].filter(function (y) { return y.id !== x.id; }).concat([x]);
    return x;
  }
  function tomb(w, key, id, now) {
    var old = null;
    w.data[key].forEach(function (x) { if (x.id === id) old = x; });
    if (!old) return;
    w.data.tombs[id] = Math.max(now, old.m, w.data.tombs[id] || 0);
    w.data[key] = w.data[key].filter(function (y) { return y.id !== id; });
  }
  function done(w) { w.data = M.merge(w.data, {}); }
  // The centre as a real row (a map may only have the drawn placeholder).
  function ensureRoot(w, R0, now, name) {
    if (!R0.root.virtual) return;
    put(w, "nodes", { id: R0.root.id, map: w.mid, parent: "", ord: "", text: name || "" }, now);
  }

  // ---------- 3. Picking ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  // Every idea in reading order (the centre first, then depth first).
  function inOrder(T) { return M.subtree(T, T.root.id); }
  // One idea named by id or words (the centre by the map's title).
  function named(T, q) {
    if (!given(q)) return null;
    if (own(T.N, q)) return q;
    var s = norm(q), all = inOrder(T), hit = null;
    all.forEach(function (id) { if (!hit && norm(T.N[id].text) === s) hit = id; });
    all.forEach(function (id) { if (!hit && s && norm(T.N[id].text).indexOf(s) >= 0) hit = id; });
    return hit;
  }
  function pick(T, st, env) {
    var ids = given(st.ids) ? String(st.ids).split(/[\s,]+/).filter(Boolean) : null, words = given(st.has) ? norm(st.has) : "";
    var inside = null;
    if (given(st.branch)) {
      var b = named(T, st.branch);
      if (!b) { note(env, "noIdea"); return []; }
      inside = {};
      M.subtree(T, b).forEach(function (id) { inside[id] = 1; });
    }
    return inOrder(T).filter(function (id) {
      if (ids && ids.indexOf(id) < 0) return false;
      if (inside && !inside[id]) return false;
      if (given(st.level) && M.depthOf(T, id) !== st.level) return false;
      if (words && norm(T.N[id].text).indexOf(words) < 0) return false;
      return true;
    });
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  // #rrggbb → the nearest of the map's branch colours.
  function nearestColor(c) {
    function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    var a = rgb(c), best = M.COLOR_KEYS[0], bd = Infinity;
    M.COLOR_KEYS.forEach(function (k) {
      var b = rgb(M.COLORS[k]), d = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }
  // The rows of the map without stamps, by kind and id (to count changes).
  function bodies(w) {
    var o = {};
    LISTS.forEach(function (key) {
      w.data[key].forEach(function (x) { o[key + ":" + x.id] = JSON.stringify(x, function (k, v) { return k === "m" ? undefined : v; }); });
    });
    return o;
  }
  function diff(a, b) {
    var k, c = 0, all = {};
    for (k in a) all[k] = 1;
    for (k in b) all[k] = 1;
    for (k in all) if (a[k] !== b[k]) c++;
    return c;
  }
  function styleOf(w, id) {
    var s = null;
    w.data.styles.forEach(function (x) { if (x.id === id) s = x; });
    return s || { id: id, map: w.mid, shape: "", fill: "", border: "", size: "", bold: false };
  }
  function kidsRows(T, pid, exclude) {
    return (T.kids[pid] || []).filter(function (id) { return id !== exclude && !T.rec[id]; }).map(function (id) { return T.N[id]; });
  }
  // A node goes under pid at the end (order keys as the app's placeUnder).
  function placeUnder(w, T, row, pid, now) {
    var p = M.placeAt(kidsRows(T, pid, row.id), Infinity);
    (p.respace || []).forEach(function (r) { put(w, "nodes", Object.assign({}, T.N[r.id], { ord: r.ord }), now); });
    return put(w, "nodes", Object.assign({}, row, { parent: pid, ord: p.ord }), now);
  }

  // ---------- 4. Applying ----------
  // One command on a map copy (work()) → how many rows changed (ideas,
  // their styles, links, frames, the map's layout). env: { notes: [],
  // now: ms, newId: () → a fresh id, untitled: the centre's text when
  // the map has none yet }.
  function apply(w, st, env) {
    env = env || {};
    var now = env.now || Date.now(), T = tree(w);
    if (!T.map) return 0;
    var before = bodies(w);
    function fin() { done(w); return diff(before, bodies(w)); }
    function fresh() { return env.newId ? env.newId() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    switch (st.op) {
      case "rename":
        put(w, "nodes", Object.assign({}, T.root, { text: st.title, virtual: undefined }), now);
        return fin();
      case "map": {
        ensureRoot(w, T, now, env.untitled);
        if (st.sides) put(w, "maps", Object.assign({}, T.map, { sides: st.sides }), now);
        if (st.layout) put(w, "layouts", { id: w.mid, map: w.mid, kind: st.layout === "map" ? "" : st.layout }, now);
        return fin();
      }
      case "add": {
        var to = given(st.to) ? named(T, st.to) : T.root.id;
        if (!to) { note(env, "noIdea"); return 0; }
        var p = M.parseOutline(st.text, "");
        if (!p.ok) return 0;
        if (T.count + 1 >= M.MAX_NODES) { note(env, "mapFull"); return 0; }
        ensureRoot(w, T, now, env.untitled);
        var sibs = kidsRows(T, to, null), lo = sibs.length ? sibs[sibs.length - 1].ord : "", keys = [], tops = M.topsOf(p.tree);
        if (sibs.length && !M.validOrd(lo)) lo = "";
        for (var k = 0; k < tops.length; k++) { var key = M.between(lo, null) || M.spread(1)[0]; keys.push(key); lo = key; }
        var rows = M.treeToRows(p.tree, fresh, now, { map: w.mid, parent: to, keys: keys });
        var room = M.MAX_NODES - T.count;
        if (rows.nodes.length > room) note(env, "mapFull");
        rows.nodes.slice(0, room).forEach(function (n) {
          if (n.parent === to) {
            if (st.c) n.color = nearestColor(st.c);
            if (given(st.emoji) && st.emoji !== "none") n.emoji = st.emoji;
            if (given(st.note) && st.note !== "none") n.note = st.note;
          }
          put(w, "nodes", n, now);
        });
        return fin();
      }
      case "link": {
        var a = named(T, st.from), b = named(T, st.to);
        if (!a || !b || a === b) { note(env, "noIdea"); return 0; }
        put(w, "links", { id: fresh(), map: w.mid, from: a, to: b, label: st.text || "" }, now);
        return fin();
      }
      case "sort": {
        var parents = picks(st) ? pick(T, st, env) : [T.root.id];
        parents.forEach(function (pid) {
          var kids = kidsRows(T, pid, null);
          if (kids.length < 2) return;
          var sorted = kids.slice().sort(function (x, y) {
            var c = String(x.text).localeCompare(String(y.text), undefined, { sensitivity: "base", numeric: true });
            return st.desc ? -c : c;
          });
          if (sorted.every(function (x, i) { return x.id === kids[i].id; })) return;
          var ks = M.spread(sorted.length);
          sorted.forEach(function (x, i) { put(w, "nodes", Object.assign({}, x, { ord: ks[i] }), now); });
        });
        return fin();
      }
    }
    var picked = pick(T, st, env);
    if (!picked.length) return 0;
    switch (st.op) {
      case "replace": {
        var rx = finder(st);
        picked.forEach(function (id) {
          var n = T.N[id], tx = String(n.text).replace(rx, function () { return st.repl; });
          if (tx === n.text) return;
          if (n.virtual) ensureRoot(w, T, now, tx);
          else put(w, "nodes", Object.assign({}, n, { text: tx }), now);
        });
        break;
      }
      case "settext":
        picked.forEach(function (id) {
          var n = T.N[id];
          if (n.virtual) ensureRoot(w, T, now, st.text);
          else put(w, "nodes", Object.assign({}, n, { text: st.text }), now);
        });
        break;
      case "node":
        ensureRoot(w, T, now, env.untitled);
        picked.forEach(function (id) {
          var n = Object.assign({}, T.N[id]), had = JSON.stringify(n);
          if (n.virtual) { delete n.virtual; n.text = n.text || env.untitled || ""; }
          if (st.c) n.color = nearestColor(st.c);
          if (given(st.emoji)) n.emoji = st.emoji === "none" ? "" : st.emoji;
          if (given(st.note)) n.note = st.note === "none" ? "" : st.note;
          if (given(st.url)) n.url = st.url === "none" ? "" : st.url.trim();
          if (st.done) n.done = st.done === "on";
          if (JSON.stringify(n) !== had) put(w, "nodes", n, now);
          if (st.shape || st.fill || st.border || st.nodesize || st.bold) {
            var s = Object.assign({}, styleOf(w, id));
            if (st.shape) s.shape = st.shape;
            if (st.fill) s.fill = st.fill;
            if (st.border) s.border = st.border;
            if (st.nodesize) s.size = st.nodesize === "m" ? "" : st.nodesize;
            if (st.bold) s.bold = st.bold === "on";
            put(w, "styles", s, now);
          }
        });
        break;
      case "move": {
        var target = named(T, st.to);
        if (!target) { note(env, "noIdea"); return 0; }
        picked.forEach(function (id) {
          if (id === T.root.id) return;
          var T2 = tree(w);
          if (!T2.N[id] || T2.par[id] === target && !T2.rec[id]) return;
          if (M.isInside(T2, id, target)) { note(env, "loop"); return; }
          placeUnder(w, T2, T2.N[id], target, now);
          done(w);
        });
        break;
      }
      case "frame": {
        var members = picked.filter(function (id) { return id !== T.root.id; });
        if (!members.length) return 0;
        if (members.length > 50) note(env, "frameMax");
        if (w.data.frames.length >= 2000) { note(env, "mapFull"); return 0; }
        put(w, "frames", { id: fresh(), map: w.mid, nodes: members.slice(0, 50), kind: st.kind || "box", label: st.text || "", color: st.c ? nearestColor(st.c) : "" }, now);
        break;
      }
      case "remove": {
        if (picked.indexOf(T.root.id) >= 0) note(env, "centre");
        var gone = {};
        picked.forEach(function (id) { if (id !== T.root.id) M.subtree(T, id).forEach(function (x) { gone[x] = 1; }); });
        Object.keys(gone).forEach(function (id) { if (!T.N[id].virtual) tomb(w, "nodes", id, now); });
        w.data.links.slice().forEach(function (l) { if (own(gone, l.from) || own(gone, l.to)) tomb(w, "links", l.id, now); });
        // a boundary / summary whose last idea goes, goes too
        w.data.frames.slice().forEach(function (f) {
          if (f.nodes.some(function (x) { return own(gone, x); }) && f.nodes.every(function (x) { return own(gone, x) || !T.N[x]; })) tomb(w, "frames", f.id, now);
        });
        break;
      }
    }
    return fin();
  }

  // ---------- 5. Undo ----------
  // A map as it is now, to bring it back later (assist.js).
  function snapshot(d, mid) {
    var o = {};
    LISTS.forEach(function (key) { o[key] = copy((d[key] || []).filter(function (x) { return mapOf(key, x) === mid; })); });
    return o;
  }
  // The map back as it was in snap, as new edits (they sync): rows it
  // had are written again, newer ones are tombstoned; positions,
  // pictures, styles and layout kinds are never tombstoned (the app
  // writes a default row instead).
  function restore(d, mid, snap, now) {
    var w = work(d, mid);
    LISTS.forEach(function (key) {
      var had = {};
      snap[key].forEach(function (x) { had[x.id] = 1; put(w, key, x, now); });
      w.data[key].slice().forEach(function (x) {
        if (own(had, x.id)) return;
        if (key === "pos") put(w, key, { id: x.id, map: x.map, dx: 0, dy: 0 }, now);
        else if (key === "imgs") put(w, key, { id: x.id, map: x.map, src: "", w: 0, h: 0 }, now);
        else if (key === "styles") put(w, key, { id: x.id, map: x.map }, now);
        else if (key === "layouts") put(w, key, { id: x.id, map: x.id, kind: "" }, now);
        else tomb(w, key, x.id, now);
      });
    });
    return M.merge(d, w.data);
  }

  // ---------- 6. For the Assistant ----------
  function title(T) { return M.title(T.root.text, 120); }
  function lastEdit(d, mid) {
    var m = 0;
    LISTS.forEach(function (key) { (d[key] || []).forEach(function (x) { if (mapOf(key, x) === mid && x.m > m) m = x.m; }); });
    return m;
  }
  // The stored slice as a list of documents (its maps, newest first):
  // { docs: [{ id, name, m }], data } (each doc's `store` is the whole
  // data).
  function view(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.maps)) return { docs: [], data: null };
    var d = M.merge(data, {});
    return { docs: d.maps.map(function (mp) {
      var o = { id: mp.id, name: title(M.resolve(d, mp.id)), m: lastEdit(d, mp.id) };
      Object.defineProperty(o, "store", { value: d });   // not copied
      return o;
    }).sort(function (a, b) { return b.m - a.m; }), data: d };
  }
  // Which maps a request is for. data: view(), open: the open map's id.
  // designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new map is made in Mind map itself; use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Mind map has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no maps in Mind map yet" };
    var out = [];
    if (designs === "all") out = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the map's title" };
      out = docs.filter(function (d) { return norm(d.name) === q; });
      if (!out.length) out = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!out.length) return { ok: false, err: "no map is called " + JSON.stringify(String(name).slice(0, 80)) + "; maps: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name); }).join(", ") };
      if (out.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several maps match " + JSON.stringify(String(name).slice(0, 80)) + ": " + out.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole title" };
      }
      if (out.length > 1) out = out.filter(function (d) { return norm(d.name) === q; });
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no map is open in Mind map; name the map (designs: named)" };
      out = [o];
    }
    return { ok: true, docs: out.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] }, recs = {}, seq = 0;
    ((data && data.docs) || []).forEach(function (d) { recs[d.id] = d.store; });
    var env = { notes: out.notes, now: Date.now(), newId: function () { seq++; return "zzpreview" + seq; } };
    ids.forEach(function (id) {
      if (!recs[id]) return;
      var w = work(recs[id], id), k = 0;
      steps.forEach(function (st) { k += apply(w, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: title(tree(w)), n: k }); }
    });
    return out;
  }
  // A map for the model: its title, layout and every idea with its id,
  // parent, level, text and what is set on it; links and frames.
  var OUT_NODES = 1500;
  function outline(doc) {
    var d = doc && doc.store;
    if (!d || !d.maps.some(function (mp) { return mp.id === doc.id; })) return null;
    var T = M.resolve(d, doc.id), all = inOrder(T);
    var o = { title: title(T), layout: T.kind || "map", sides: T.map.sides, centre: T.root.id, ideas: [] };
    all.slice(0, OUT_NODES).forEach(function (id) {
      var n = T.N[id], e = { id: id, level: M.depthOf(T, id), text: n.text };
      if (id !== T.root.id) e.parent = T.par[id];
      if (n.color) e.c = n.color;
      if (n.emoji) e.emoji = n.emoji;
      if (n.note) e.note = n.note.slice(0, 500);
      if (n.url) e.url = n.url;
      if (n.done) e.done = "on";
      var s = T.sty[id];
      if (s) {
        if (s.shape) e.shape = s.shape;
        if (s.fill) e.fill = s.fill;
        if (s.border) e.border = s.border;
        if (s.size) e.nodesize = s.size;
        if (s.bold) e.bold = "on";
      }
      if (T.img[id]) e.picture = true;
      o.ideas.push(e);
    });
    if (all.length > OUT_NODES) o.note = "Only the first " + OUT_NODES + " of " + all.length + " ideas are listed.";
    if (T.links.length) o.links = T.links.slice(0, 300).map(function (l) { return { id: l.id, from: l.from, to: l.to, text: l.label }; });
    if (T.frames.length) o.frames = T.frames.slice(0, 300).map(function (f) { return { id: f.id, kind: f.kind, text: f.label, ideas: f.nodes }; });
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS,
    check: check, pick: pick, work: work, apply: apply, snapshot: snapshot, restore: restore, nearestColor: nearestColor,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.MindmapCommands = api;
})(typeof window !== "undefined" ? window : this);
