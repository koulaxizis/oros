// ============================================================
// orOS Whiteboard — kit.js: dot voting, templates, Mind map import,
// notes for other apps and the timer's clock (wave D2; pure, no DOM)
// Loaded by index.html after core.js, and by Node in the tests.
// Nothing here changes the WHITEBOARD v1 data:
// - a vote is a dot: an ordinary solid ellipse shape DOT × DOT with
//   no text, stuck on top of the note, shape, text or picture it
//   votes for. Devices still on the D1 code see and keep it as a
//   small circle (their cleanObj knows every field), so no vote is
//   ever stripped by an older device. Which object a dot votes for
//   is worked out from where it lies (tally), the same on every
//   device;
// - templates and Mind map imports are plain objects with fresh ids,
//   added in one undo step;
// - the timer is device-local (prefs), never synced.
// Exposes window.WhiteboardKit (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.WhiteboardCore;

  var DOT = 22, GAP = 4, PAD = 6;
  var MAX_TREE = 250;                    // ideas one Mind map import brings
  var MAX_VOTES = 20;                    // dots one person may have
  var TARGETS = { note: 1, shape: 1, text: 1, image: 1 };

  function r2(v) { return Math.round(v * 100) / 100; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- 1. Dot voting ----------
  function isDot(o) {
    return !!o && o.k === "shape" && o.shp === "ellipse" && o.f === "solid" && o.w === DOT && o.h === DOT && !o.tx;
  }
  function votable(o) { return !!o && own(TARGETS, o.k) && !isDot(o); }

  // The object a dot votes for: the top-most votable object under the
  // dot's centre (frames, arrows and pen lines never take votes).
  function targetOf(dot, cands, m, measure) {
    var cx = dot.x + DOT / 2, cy = dot.y + DOT / 2, best = null;
    cands.forEach(function (o) {
      var b = C.box(o, m, measure);
      if (cx < b.x || cy < b.y || cx > b.x + b.w || cy > b.y + b.h) return;
      if (!best || o.z > best.z || (o.z === best.z && o.id > best.id)) best = o;
    });
    return best;
  }

  // { counts: { targetId: n }, of: { dotId: targetId } }. Dots on
  // nothing count for nothing.
  function tally(list, measure) {
    var m = C.index(list), cands = list.filter(votable), counts = {}, of = {};
    list.forEach(function (o) {
      if (!isDot(o)) return;
      var t = targetOf(o, cands, m, measure);
      if (!t) return;
      of[o.id] = t.id;
      counts[t.id] = (counts[t.id] || 0) + 1;
    });
    return { counts: counts, of: of };
  }

  // Objects with votes, most votes first (then top to bottom, left to right).
  function ranked(list, measure) {
    var tl = tally(list, measure), m = C.index(list);
    return Object.keys(tl.counts).map(function (id) { return { id: id, n: tl.counts[id], o: m[id] }; })
      .sort(function (a, b) { return b.n - a.n || a.o.y - b.o.y || a.o.x - b.o.x || (a.id < b.id ? -1 : 1); });
  }

  // A new dot on `target`: in the first free place of a row along the
  // bottom right corner, filling upwards (a removed dot's place is
  // used again). o = { id, c, z }.
  function dotFor(target, list, o, measure) {
    var b = C.box(target, C.index(list), measure);
    var per = Math.max(1, Math.floor((b.w - PAD * 2 + GAP) / (DOT + GAP)));
    var rows = Math.max(1, Math.floor((b.h - PAD * 2 + GAP) / (DOT + GAP)));
    var taken = list.filter(isDot);
    for (var i = 0; i < per * rows * 4; i++) {
      var col = i % per, row = Math.floor(i / per) % rows, layer = Math.floor(i / (per * rows));
      var x = r2(b.x + b.w - PAD - DOT - col * (DOT + GAP) - layer * 3);
      var y = r2(b.y + b.h - PAD - DOT - row * (DOT + GAP) - layer * 3);
      var hit = taken.some(function (d) { return Math.abs(d.x - x) < DOT / 2 && Math.abs(d.y - y) < DOT / 2; });
      if (!hit) return { id: o.id, b: target.b, k: "shape", shp: "ellipse", f: "solid", c: o.c, x: x, y: y, w: DOT, h: DOT, tx: "", z: o.z };
    }
    return null;
  }

  // The dots that sit on any of `ids` (they move with them).
  function dotsOn(list, ids, measure) {
    var of = tally(list, measure).of, want = {}, out = [];
    ids.forEach(function (id) { want[id] = 1; });
    Object.keys(of).forEach(function (d) { if (want[of[d]]) out.push(d); });
    return out.sort();
  }

  // ---------- 2. Templates ----------
  // L = translated labels; newId() from the app. Objects are laid out
  // around 0, 0; place() moves them where the app wants them.
  var TEMPLATES = ["brainstorm", "retro", "swot", "roadmap"];
  function template(kind, L, newId) {
    var out = [], z = 1;
    function add(o) { o.id = newId(); o.b = "-"; if (o.z === undefined) o.z = o.k === "frame" ? 0 : z++; out.push(o); return o; }
    function title(tx, x, y, w) { return add({ k: "text", x: x, y: y, w: w, h: 48, fs: 40, tx: tx, c: "ink" }); }
    function note(tx, x, y, c) { return add({ k: "note", x: x, y: y, w: 200, h: 200, tx: tx || "", c: c }); }
    function frame(tx, x, y, w, h, c) { return add({ k: "frame", x: x, y: y, w: w, h: h, tx: tx, c: c }); }
    if (kind === "brainstorm") {
      title(L.brainstorm, -480, -520, 960);
      var hub = add({ k: "shape", shp: "ellipse", f: "soft", c: "purple", x: -170, y: -90, w: 340, h: 180, tx: L.topic });
      var cols = ["yellow", "orange", "pink", "green", "blue", "teal", "yellow", "orange"];
      for (var i = 0; i < 8; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 4, n = note("", r2(Math.cos(a) * 470 - 100), r2(Math.sin(a) * 330 - 100), cols[i]);
        add({ k: "arrow", ax: 0, ay: 0, bx: 0, by: 0, ao: hub.id, bo: n.id, hd: "none", ds: false, tx: "", c: "gray" });
      }
    } else if (kind === "retro") {
      title(L.retro, -680, -440, 1360);
      [[L.well, "green"], [L.better, "orange"], [L.actions, "blue"]].forEach(function (p, i) {
        var x = -680 + i * 460;
        frame(p[0], x, -340, 440, 660, p[1]);
        note("", x + 30, -310, p[1]);
        note("", x + 30, -80, p[1]);
      });
    } else if (kind === "swot") {
      title(L.swot, -500, -560, 1000);
      [[L.s, "green", 0, 0], [L.w, "red", 1, 0], [L.o, "blue", 0, 1], [L.t, "orange", 1, 1]].forEach(function (p) {
        var x = -500 + p[2] * 510, y = -460 + p[3] * 500;
        frame(p[0], x, y, 490, 470, p[1]);
        note("", x + 30, y + 30, p[1]);
        note("", x + 260, y + 30, p[1]);
      });
    } else if (kind === "roadmap") {
      title(L.roadmap, -700, -480, 1400);
      [[L.now, "teal", "teal"], [L.next, "purple", "purple"], [L.later, "gray", "yellow"]].forEach(function (p, i) {
        var x = -700 + i * 480;
        frame(p[0], x, -300, 440, 640, p[1]);
        note("", x + 30, -270, p[2]);
        note("", x + 30, -40, p[2]);
      });
      add({ k: "arrow", ax: -700, ay: -370, bx: 700, by: -370, ao: "", bo: "", hd: "end", ds: false, tx: L.time, c: "ink" });
    } else return [];
    return out;
  }

  // Copies of objs moved so their middle is at cx, cy, drawn above z0,
  // on board b. Arrow ends follow; ids stay.
  function place(objs, cx, cy, z0, b) {
    var r = C.bounds(objs, null, 0);
    if (!r) return [];
    var dx = r2(cx - (r.x + r.w / 2)), dy = r2(cy - (r.y + r.h / 2));
    return objs.map(function (o) {
      var c = C.moved(o, dx, dy);
      if (c.k === "arrow") { c.ax = r2(o.ax + dx); c.ay = r2(o.ay + dy); c.bx = r2(o.bx + dx); c.by = r2(o.by + dy); }
      c.b = b;
      if (c.k !== "frame") c.z = (z0 || 0) + o.z;
      return c;
    });
  }

  // ---------- 3. Mind map import ----------
  // tree = { tx, kids: [tree] } (the app builds it from MMCore.resolve).
  // A tree laid out to the right: the centre as a shape, each idea a
  // sticky note in its main branch's colour, joined by arrows.
  var BRANCH = ["yellow", "pink", "blue", "green", "orange", "purple", "teal"];
  function fromTree(tree, newId, max) {
    max = max || MAX_TREE;
    var out = [], n = 0, cut = false, z = 1, nextY = 0;
    var NW = 200, NH = 120, COL = 300, ROW = 150;
    function walk(t, depth, color, parent) {
      if (n >= max) { cut = true; return null; }
      n++;
      var kids = (t.kids || []).slice(), me = { id: newId(), b: "-", z: z++, tx: String(t.tx || "").slice(0, C.MAX_TEXT) };
      out.push(me);
      if (depth === 0) { me.k = "shape"; me.shp = "round"; me.f = "soft"; me.c = "purple"; me.w = 260; me.h = 130; }
      else { me.k = "note"; me.c = color; me.w = NW; me.h = NH; }
      me.x = depth === 0 ? 0 : 60 + COL * depth;
      var ys = [];
      kids.forEach(function (k, i) {
        var c = walk(k, depth + 1, depth === 0 ? BRANCH[i % BRANCH.length] : color, me);
        if (c) ys.push(c.y + c.h / 2);
      });
      if (ys.length) me.y = r2((ys[0] + ys[ys.length - 1]) / 2 - me.h / 2);
      else { me.y = nextY; nextY += ROW; }
      if (parent) out.push({ id: newId(), b: "-", k: "arrow", ax: 0, ay: 0, bx: 0, by: 0, ao: parent.id, bo: me.id, hd: "none", ds: false, tx: "", c: "gray", z: 0 });
      return me;
    }
    walk(tree, 0, "yellow", null);
    // arrows get their ends' middles as the points they keep
    var m = C.index(out);
    out.forEach(function (o) {
      if (o.k !== "arrow") return;
      var a = m[o.ao], b = m[o.bo];
      o.ax = r2(a.x + a.w / 2); o.ay = r2(a.y + a.h / 2); o.bx = r2(b.x + b.w / 2); o.by = r2(b.y + b.h / 2);
    });
    return { objs: out, cut: cut, count: n };
  }

  // ---------- 4. Notes for other apps (BR-SEND items) ----------
  // Notes, shapes and texts with words, in reading order: top to
  // bottom in bands, left to right in a band. First line = the item,
  // the rest = its note.
  function items(list) {
    return list.filter(function (o) { return (o.k === "note" || o.k === "shape" || o.k === "text") && !isDot(o) && C.words(o); })
      .sort(function (a, b) { return Math.round(a.y / 80) - Math.round(b.y / 80) || a.x - b.x || (a.id < b.id ? -1 : 1); })
      .map(function (o) {
        var lines = String(o.tx).replace(/\r/g, "").split("\n").map(function (s) { return s.trim(); });
        while (lines.length && !lines[0]) lines.shift();
        return { text: lines[0].slice(0, 300), note: lines.slice(1).join("\n").trim().slice(0, 1000) };
      });
  }

  // ---------- 5. The timer's clock ----------
  // timer = { end (ms, running), left (ms, paused), dur (ms) }.
  function remaining(tm, now) {
    if (!tm || !tm.dur) return 0;
    if (tm.end) return Math.max(0, tm.end - now);
    return Math.max(0, tm.left || 0);
  }
  function clock(ms) {
    var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    var p = function (v) { return (v < 10 ? "0" : "") + v; };
    return h ? h + ":" + p(mm) + ":" + p(ss) : p(mm) + ":" + p(ss);
  }

  var API = {
    DOT: DOT, MAX_TREE: MAX_TREE, MAX_VOTES: MAX_VOTES, TEMPLATES: TEMPLATES, BRANCH: BRANCH,
    isDot: isDot, votable: votable, tally: tally, ranked: ranked, dotFor: dotFor, dotsOn: dotsOn,
    template: template, place: place, fromTree: fromTree, items: items, remaining: remaining, clock: clock
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.WhiteboardKit = API;
})(typeof window !== "undefined" ? window : globalThis);
