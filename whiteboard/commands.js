// ============================================================
// orOS Whiteboard — commands.js: what the Assistant may change on a
// board (AS-EDIT, wave WB1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Whiteboard, in
// the step format of the automations (recipes/core.js specs; field
// names as in the other catalogs where they mean the same). The same
// file runs in two places:
//   - in the Assistant, to check a command list, find the boards it is
//     for (targets), count what it would change on a copy (preview)
//     and describe a board to the AI (outline, with the user's
//     consent);
//   - in Whiteboard (assist.js), which applies it and saves the result
//     as new edits of the board, so it syncs like any other change.
// Every change goes through WhiteboardCore's own edits (apply,
// putBoard), so it is checked and stamped as if made by hand. Objects
// are picked with:
//   ids    object ids from read_in_app (comma separated)
//   what   "" (everything) | note | text | shape | arrow | pen | image
//          | frame
//   has    words in an object's text
//   frame  a frame's name (or id): the objects inside it
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more (add and connect make new objects each
// time).
// Pure: no DOM. Needs recipes/core.js and whiteboard/core.js
// (WhiteboardCore). Exposes window.WhiteboardCommands (browser) or
// module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var C = node ? require("./core.js") : root.WhiteboardCore;
  if (!R || !C) return;

  var WHAT = [""].concat(C.KINDS);
  var TEXT_KINDS = { note: 1, text: 1, shape: 1, arrow: 1, frame: 1 };
  var MAX_OBJS = 2000;                 // as the app: one board holds at most this many
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  function n(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  function i(lo, hi) { return { t: "int", lo: lo, hi: hi, def: null }; }
  var POS = { x: n(-1e6, 1e6), y: n(-1e6, 1e6), w: n(8, 50000), h: n(8, 50000) };
  var SEL = { ids: { t: "str", max: 2000 }, what: oneOf(WHAT), has: { t: "str", max: 200 }, frame: { t: "str", max: 120 } };
  function sel(args) {
    var o = {};
    Object.keys(SEL).forEach(function (k) { o[k] = SEL[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }
  function plus(a, b) { var o = {}; [a, b].forEach(function (x) { Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return o; }
  var LOOK = { c: { t: "color" }, shape: oneOf([""].concat(C.SHAPES)), fill: oneOf([""].concat(C.FILLS)), size: i(8, 200) };
  var LINE = { ends: oneOf([""].concat(C.HEADS)), dash: ONOFF };

  // kind: "doc" (every command edits a board)
  var CATALOG = {
    replace: { kind: "doc", args: sel({ find: { t: "str", max: 500, req: 1 }, repl: { t: "str", max: 500 }, cs: { t: "bool" }, word: { t: "bool" } }) },
    settext: { kind: "doc", args: sel({ text: { t: "str", max: 5000, req: 1 } }) },
    style: { kind: "doc", args: sel(plus(plus(LOOK, LINE), { sw: n(1, 40) })) },
    move: { kind: "doc", args: sel(plus(POS, { dx: n(-50000, 50000), dy: n(-50000, 50000), order: oneOf(["", "front", "back"]) })) },
    arrange: { kind: "doc", args: sel({ n: i(1, 50), gap: n(0, 2000), x: POS.x, y: POS.y }) },
    add: { kind: "doc", args: plus(plus({ what: { t: "enum", v: ["note", "text", "shape", "frame"], def: "note" }, text: { t: "str", max: 5000 } }, POS), LOOK) },
    connect: { kind: "doc", args: plus({ from: { t: "str", max: 200, req: 1 }, to: { t: "str", max: 200, req: 1 }, text: { t: "str", max: 120 }, c: { t: "color" } }, LINE) },
    remove: { kind: "doc", args: sel({}) },
    rename: { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  var COLOR_LIST = C.COLOR_KEYS.map(function (k) { return k + " " + C.COLORS[k][0]; }).join(", ");
  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Whiteboard commands (documents are boards; objects are picked with ids (object ids from read_in_app, comma separated), what (\"\" everything, or " + C.KINDS.join(", ") + "), " +
    "has (words in an object's text) and frame (a frame's name or id: the objects inside it); x, y, w, h are board pixels (x, y the top-left); colours are given as #rrggbb and snap to the board's colours (" + COLOR_LIST + "); " +
    "null or \"\" leaves a field as it is):\n" + [
    "replace: find → repl in the text of the picked notes, texts, shapes, arrow labels and frame names (cs = match case, word = whole words)",
    "settext: the text of the picked objects becomes `text`",
    "style: for the picked objects c (colour), shape " + C.SHAPES.join("|") + " (shapes), fill " + C.FILLS.join("|") + " (shapes), size (8-200, font size of free text), ends " + C.HEADS.join("|") + " (arrow heads), dash on|off (dashed arrows), sw (1-40, pen width)",
    "move: the picked objects go by dx, dy, or to x, y (the first picked one; the others keep their place next to it); w, h resize notes, texts, shapes, pictures, frames and drawings; order front|back brings them to the front or sends them back",
    "arrange: lay the picked notes, shapes, texts and pictures out in a grid of n columns (default: about square) with gap pixels between them (default 24), starting at x, y (default: where the first one is)",
    "add: a new object (what note|text|shape|frame) with text (a frame's name), at x, y (default: to the right of everything on the board), size w, h, colour c, shape, fill, size (free text)",
    "connect: an arrow from the object `from` to the object `to` (an id, or words of its text), with text (its label), c, ends, dash",
    "remove: delete the picked objects (needs ids, what, has or frame)",
    "rename: the board's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var IDS_RX = /^[\s,A-Za-z0-9_-]*$/;
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function picks(st) { return given(st.ids) || given(st.what) || given(st.has) || given(st.frame); }
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
    if (typeof raw.ids === "string" && !IDS_RX.test(raw.ids)) bad.push("ids must be object ids from read_in_app, comma separated");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (st.op === "remove" && !picks(st)) return { err: "remove: pick the objects with ids, what, has or frame" };
    if (st.op === "move" && !given(st.dx) && !given(st.dy) && !given(st.x) && !given(st.y) && !given(st.w) && !given(st.h) && !st.order) return { err: "move: give dx, dy, x, y, w, h or order" };
    if (st.op === "style" && !st.c && !st.shape && !st.fill && !given(st.size) && !st.ends && !st.dash && !given(st.sw)) return { err: "style: give c, shape, fill, size, ends, dash or sw" };
    if (st.op === "add" && st.what !== "shape" && !given(st.text)) return { err: "add: a " + st.what + " needs text" };
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

  // ---------- 2. Picking ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  // A board as the commands see it: { bid, data } where data holds that
  // one board and what is on it (WhiteboardCore's edits work on it as
  // on the whole).
  function work(d, bid) {
    var b = C.board(d, bid);
    var part = { ver: C.VER, boards: b ? [b] : [], objs: d.objs.filter(function (o) { return o.b === bid; }), tombs: d.tombs };
    return { bid: bid, data: C.normalize(JSON.parse(JSON.stringify(part))) };
  }
  function brd(w) { return C.board(w.data, w.bid); }
  function list(w) { return C.objsOf(w.data, w.bid); }
  function frameOf(w, name) {
    var q = norm(name), all = list(w).filter(function (o) { return o.k === "frame"; });
    return all.filter(function (f) { return f.id === name; })[0] || all.filter(function (f) { return norm(f.tx) === q; })[0] ||
      all.filter(function (f) { return q && norm(f.tx).indexOf(q) >= 0; })[0] || null;
  }
  // The picked objects, in drawing order.
  function pick(w, st, env) {
    var ids = given(st.ids) ? String(st.ids).split(/[\s,]+/).filter(Boolean) : null, words = given(st.has) ? norm(st.has) : "";
    var all = list(w), inside = null;
    if (given(st.frame)) {
      var f = frameOf(w, st.frame);
      if (!f) { note(env, "noFrame"); return []; }
      inside = {};
      C.inFrame(all, f).forEach(function (o) { if (o.id !== f.id) inside[o.id] = 1; });
    }
    return all.filter(function (o) {
      if (ids && ids.indexOf(o.id) < 0) return false;
      if (st.what && o.k !== st.what) return false;
      if (inside && !inside[o.id]) return false;
      if (words && norm(o.tx).indexOf(words) < 0) return false;
      return true;
    });
  }
  // An object named by id or by words of its text (connect).
  function named(w, q) {
    var all = list(w).filter(function (o) { return o.k !== "arrow" && o.k !== "pen"; }), s = norm(q);
    return all.filter(function (o) { return o.id === q; })[0] || all.filter(function (o) { return s && norm(o.tx) === s; })[0] ||
      all.filter(function (o) { return s && norm(o.tx).indexOf(s) >= 0; })[0] || null;
  }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function finder(st) {
    var src = esc(st.find);
    if (st.word) src = "(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])";
    return new RegExp(src, "gu" + (st.cs ? "" : "i"));
  }
  // #rrggbb → the nearest of the board's colours (by its strong shade).
  function nearestColor(c) {
    function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    var a = rgb(c), best = C.COLOR_KEYS[0], bd = Infinity;
    C.COLOR_KEYS.forEach(function (k) {
      [0, 1].forEach(function (s) {
        var b = rgb(C.COLORS[k][s]), d = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
        if (d < bd) { bd = d; best = k; }
      });
    });
    return best;
  }
  function r1(v) { return Math.round(v); }
  // A text object's height follows its lines.
  function fitText(o) { if (o.k === "text") o.h = Math.max(8, r1(C.textHeight(o))); return o; }

  // ---------- 3. Applying ----------
  // Each object and the board's name, without stamps, by id.
  function bodies(w) {
    var o = {}, b = brd(w);
    if (b) o[b.id] = b.name;
    list(w).forEach(function (x) { o[x.id] = JSON.stringify(x, function (k, v) { return k === "m" ? undefined : v; }); });
    return o;
  }
  function diff(a, b) {
    var k, c = 0, all = {};
    for (k in a) all[k] = 1;
    for (k in b) all[k] = 1;
    for (k in all) if (a[k] !== b[k]) c++;
    return c;
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function put(w, rows, now) { if (Object.keys(rows).length) w.data = C.apply(w.data, rows, now); }
  function room(w, k, env) {
    if (list(w).length + k <= MAX_OBJS) return true;
    note(env, "full");
    return false;
  }
  var SIZE = { note: [200, 200], text: [280, 30], shape: [200, 120], frame: [640, 420] };

  // One command on a board copy (work()) → how many objects (and the
  // board's name) changed. env: { notes: [], now: ms, newId: () → a
  // fresh object id }.
  function apply(w, st, env) {
    env = env || {};
    var now = env.now || Date.now(), b = brd(w);
    if (!b) return 0;
    var before = bodies(w);
    function done() { return diff(before, bodies(w)); }
    function fresh() { return env.newId ? env.newId() : C.uid(); }
    var rows = {};
    switch (st.op) {
      case "rename":
        w.data = C.putBoard(w.data, w.bid, st.title, now);
        return done();
      case "add": {
        if (!room(w, 1, env)) return 0;
        var sz = SIZE[st.what], bx = C.bounds(list(w), null, 0);
        var o = { id: fresh(), b: w.bid, k: st.what, c: st.c ? nearestColor(st.c) : C.DEF_COLOR[st.what],
          x: given(st.x) ? st.x : bx ? bx.x + bx.w + 40 : 0, y: given(st.y) ? st.y : bx ? bx.y : 0,
          w: given(st.w) ? st.w : sz[0], h: given(st.h) ? st.h : sz[1], tx: st.text || "",
          z: st.what === "frame" ? C.zBottom(w.data, w.bid) : C.zTop(w.data, w.bid) };
        if (st.what === "text") o.fs = given(st.size) ? st.size : 24;
        if (st.what === "shape") { o.shp = st.shape || "rect"; o.f = st.fill || "soft"; }
        rows[o.id] = fitText(o);
        put(w, rows, now);
        return done();
      }
      case "connect": {
        var A = named(w, st.from), B = named(w, st.to);
        if (!A || !B || A.id === B.id) { note(env, "noEnd"); return 0; }
        if (!room(w, 1, env)) return 0;
        var ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
        var ar = { id: fresh(), b: w.bid, k: "arrow", c: st.c ? nearestColor(st.c) : "ink", z: C.zTop(w.data, w.bid),
          ax: ca.x, ay: ca.y, bx: cb.x, by: cb.y, ao: A.id, bo: B.id, hd: st.ends || "end", ds: st.dash === "on", tx: st.text || "" };
        rows[ar.id] = ar;
        put(w, rows, now);
        return done();
      }
    }
    var picked = pick(w, st, env);
    if (!picked.length) return 0;
    switch (st.op) {
      case "remove":
        picked.forEach(function (o) { rows[o.id] = null; });
        break;
      case "replace": {
        var rx = finder(st);
        picked.forEach(function (o) {
          if (!TEXT_KINDS[o.k] || !o.tx) return;
          var tx = o.tx.replace(rx, function () { return st.repl; });
          if (tx !== o.tx) rows[o.id] = fitText(Object.assign(copy(o), { tx: tx }));
        });
        break;
      }
      case "settext":
        picked.forEach(function (o) {
          if (!TEXT_KINDS[o.k]) return;
          rows[o.id] = fitText(Object.assign(copy(o), { tx: st.text }));
        });
        break;
      case "style":
        picked.forEach(function (o) {
          var c = copy(o);
          if (st.c && o.k !== "image") c.c = nearestColor(st.c);
          if (o.k === "shape") { if (st.shape) c.shp = st.shape; if (st.fill) c.f = st.fill; }
          if (o.k === "text" && given(st.size)) c.fs = st.size;
          if (o.k === "arrow") { if (st.ends) c.hd = st.ends; if (st.dash) c.ds = st.dash === "on"; }
          if (o.k === "pen" && given(st.sw)) c.sw = st.sw;
          rows[o.id] = fitText(c);
        });
        break;
      case "move": {
        var lead = picked.filter(function (o) { return o.k !== "arrow"; })[0] || null;
        var dx = given(st.dx) ? st.dx : 0, dy = given(st.dy) ? st.dy : 0;
        if (lead && given(st.x)) dx = st.x - lead.x;
        if (lead && given(st.y)) dy = st.y - lead.y;
        var zt = C.zTop(w.data, w.bid), zb = C.zBottom(w.data, w.bid);
        picked.forEach(function (o, k) {
          var c = dx || dy ? C.moved(o, dx, dy) : copy(o);
          if (o.k !== "arrow" && (given(st.w) || given(st.h))) c = C.resized(c, given(st.w) ? st.w : c.w, given(st.h) ? st.h : c.h);
          if (st.order === "front") c.z = zt + k;
          if (st.order === "back") c.z = zb - picked.length + k;
          rows[o.id] = fitText(c);
        });
        break;
      }
      case "arrange": {
        var items = picked.filter(function (o) { return o.k !== "arrow" && o.k !== "pen" && o.k !== "frame"; });
        if (!items.length) return 0;
        var cols = given(st.n) ? st.n : Math.ceil(Math.sqrt(items.length)), gap = given(st.gap) ? st.gap : 24;
        var x0 = given(st.x) ? st.x : items[0].x, y0 = given(st.y) ? st.y : items[0].y;
        var cw = 0, rh = [];
        items.forEach(function (o, k) { cw = Math.max(cw, o.w); var r = Math.floor(k / cols); rh[r] = Math.max(rh[r] || 0, o.h); });
        var ys = [y0];
        for (var r = 1; r < rh.length; r++) ys[r] = ys[r - 1] + rh[r - 1] + gap;
        items.forEach(function (o, k) {
          var nx = x0 + (k % cols) * (cw + gap), ny = ys[Math.floor(k / cols)];
          rows[o.id] = C.moved(o, Math.round((nx - o.x) * 100) / 100, Math.round((ny - o.y) * 100) / 100);
        });
        break;
      }
    }
    put(w, rows, now);
    return done();
  }

  // ---------- 4. Undo ----------
  // A board as it is now, to bring it back later (assist.js).
  function snapshot(d, bid) {
    var b = C.board(d, bid);
    return b ? { name: b.name, objs: copy(C.objsOf(d, bid)) } : null;
  }
  // The board back as it was in snap, as new edits (they sync).
  function restore(d, bid, snap, now) {
    var out = d, rows = {}, had = {};
    snap.objs.forEach(function (o) { had[o.id] = 1; rows[o.id] = copy(o); });
    C.objsOf(d, bid).forEach(function (o) { if (!had[o.id]) rows[o.id] = null; });
    var b = C.board(d, bid);
    if (b && b.name !== snap.name) out = C.putBoard(out, bid, snap.name, now);
    return C.apply(out, rows, now);
  }

  // ---------- 5. For the Assistant ----------
  function lastEdit(d, bid) {
    var m = (C.board(d, bid) || { m: 0 }).m;
    d.objs.forEach(function (o) { if (o.b === bid && o.m > m) m = o.m; });
    return m;
  }
  // The stored slice as a list of documents (its boards, newest first):
  // { docs: [{ id, name, m }], data } (each doc's `store` is the whole
  // data).
  function view(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.boards)) return { docs: [], data: null };
    var d = C.normalize(data);
    return { docs: d.boards.map(function (b) {
      var o = { id: b.id, name: b.name, m: lastEdit(d, b.id) };
      Object.defineProperty(o, "store", { value: d });   // not copied
      return o;
    }).sort(function (a, b) { return b.m - a.m; }), data: d };
  }
  // Which boards a request is for. data: view(), open: the open board's
  // id. designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new board is made in Whiteboard itself; use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Whiteboard has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no boards in Whiteboard yet" };
    var out = [];
    if (designs === "all") out = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the board's name" };
      out = docs.filter(function (d) { return norm(d.name) === q; });
      if (!out.length) out = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!out.length) return { ok: false, err: "no board is called " + JSON.stringify(String(name).slice(0, 80)) + "; boards: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name); }).join(", ") };
      if (out.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several boards match " + JSON.stringify(String(name).slice(0, 80)) + ": " + out.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
      if (out.length > 1) out = out.filter(function (d) { return norm(d.name) === q; });
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      // Whiteboard opens the newest board when none was open
      if (!o && !open) o = docs[0];
      if (!o) return { ok: false, err: "no board is open in Whiteboard; name the board (designs: named)" };
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
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: brd(w).name, n: k }); }
    });
    return out;
  }
  // A board for the model: its name and every object with its id, kind,
  // place, size, text, colour and what it is stuck to.
  var OUT_OBJS = 800;
  function outline(doc) {
    var d = doc && doc.store, b = d && C.board(d, doc.id);
    if (!b) return null;
    var all = C.objsOf(d, b.id), frames = all.filter(function (o) { return o.k === "frame"; }), inF = {};
    frames.forEach(function (f) { C.inFrame(all, f).forEach(function (o) { if (o.id !== f.id && !inF[o.id]) inF[o.id] = f.tx || f.id; }); });
    var o = { name: b.name, objects: [] };
    all.slice(0, OUT_OBJS).forEach(function (x) {
      var e = { id: x.id, kind: x.k, c: x.c };
      if (x.k === "arrow") {
        e.from = x.ao || [x.ax, x.ay]; e.to = x.bo || [x.bx, x.by];
        if (x.hd !== "end") e.ends = x.hd;
        if (x.ds) e.dash = "on";
      } else { e.x = x.x; e.y = x.y; e.w = x.w; e.h = x.h; }
      if (TEXT_KINDS[x.k] && x.tx) e.text = x.tx;
      if (x.k === "shape") { e.shape = x.shp; e.fill = x.f; }
      if (x.k === "text") e.size = x.fs;
      if (x.k === "pen") e.sw = x.sw;
      if (inF[x.id]) e.frame = inF[x.id];
      o.objects.push(e);
    });
    if (all.length > OUT_OBJS) o.note = "Only the first " + OUT_OBJS + " of " + all.length + " objects are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS,
    check: check, pick: pick, work: work, apply: apply, snapshot: snapshot, restore: restore, nearestColor: nearestColor,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.WhiteboardCommands = api;
})(typeof window !== "undefined" ? window : this);
