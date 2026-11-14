// ============================================================
// orOS designkit — pathedit: the pen and point editing (v1.0.0, V1)
// Shared by Atelier and Layout: the gestures, the drawing over the
// canvas and the bar of actions; each app gives a host that maps
// coordinates and writes the document (designkit/vector.js does the
// geometry).
//   session(host, { mode: "pen" | "nodes", cmds }) → S
//     S.down(ev) / S.move(ev) / S.up(ev) → true when taken; ev = { sx,
//       sy (CSS px on the canvas), shift, alt, touch }. A touch on
//       empty space is not taken (the app pans); the app calls
//       S.tapEmpty() when that touch was a tap.
//     S.key(e) → true when taken (Enter, Escape, Delete, Backspace,
//       arrows); S.paint(ctx) draws in screen space (CSS px)
//     S.actions() → [{ id, label, on, disabled }], S.act(id)
//     S.bar(el) fills a bar with the actions (refreshed on change)
//     S.cancel(), S.mode, S.paths (in the host's space)
// host = {
//   toScreen(x, y) → [sx, sy], toSpace(sx, sy) → [x, y]
//   begin(), set(paths) → false when refused, end()   one undo step
//   create(paths)   the pen's outline (host space)  → false when refused
//   exit()          the session is over
//   redraw(), say(text), accent
// }
// Strings are designkit's ("pe." keys, EN, EL, German pack).
// ============================================================
(function (root) {
  "use strict";

  var V = typeof module !== "undefined" && module.exports ? require("./vector.js") : root.orosDK.vector;

  var STR = {
    en: {
      "pe.pen": "Pen", "pe.edit": "Edit points", "pe.done": "Done", "pe.cancel": "Cancel",
      "pe.undoPt": "Undo point", "pe.close": "Close path", "pe.open": "Open path",
      "pe.corner": "Corner", "pe.smooth": "Smooth", "pe.sym": "Symmetric", "pe.straight": "Straight",
      "pe.add": "Add point", "pe.del": "Delete point", "pe.break": "Break", "pe.join": "Join",
      "pe.hintPen": "Tap to add points, drag to curve them. Tap the first point to close the shape.",
      "pe.hintEdit": "Drag points and handles. Double-tap the outline to add a point.",
      "pe.tooBig": "This outline has too many points.",
      "pe.min": "An outline needs at least two points.",
      "pe.bar": "Points"
    },
    el: {
      "pe.pen": "Πένα", "pe.edit": "Επεξεργασία σημείων", "pe.done": "Τέλος", "pe.cancel": "Ακύρωση",
      "pe.undoPt": "Αναίρεση σημείου", "pe.close": "Κλείσιμο διαδρομής", "pe.open": "Άνοιγμα διαδρομής",
      "pe.corner": "Γωνία", "pe.smooth": "Ομαλό", "pe.sym": "Συμμετρικό", "pe.straight": "Ίσιο",
      "pe.add": "Προσθήκη σημείου", "pe.del": "Διαγραφή σημείου", "pe.break": "Κόψιμο", "pe.join": "Ένωση",
      "pe.hintPen": "Πάτα για να βάλεις σημεία, σύρε για να τα καμπυλώσεις. Πάτα το πρώτο σημείο για να κλείσει το σχήμα.",
      "pe.hintEdit": "Σύρε σημεία και λαβές. Διπλό πάτημα στο περίγραμμα προσθέτει σημείο.",
      "pe.tooBig": "Αυτό το περίγραμμα έχει πάρα πολλά σημεία.",
      "pe.min": "Ένα περίγραμμα θέλει τουλάχιστον δύο σημεία.",
      "pe.bar": "Σημεία"
    }
  };
  function table() {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (!I) return STR.en;
    var c = I.lang();
    if (c === "el" || c === "en") return STR[c];
    return I.table(STR, "designkit", c) || STR.en;
  }
  function tr(k) { var tb = table(); return tb[k] || STR.en[k] || k; }

  // Icons for the bar (24 × 24, stroked).
  var ICON = {
    corner: '<path d="M5 19L12 5l7 14"/><rect x="10" y="3" width="4" height="4"/>',
    smooth: '<path d="M4 18c3-12 13-12 16 0"/><path d="M5 7h14"/><circle cx="12" cy="7" r="2"/>',
    sym: '<path d="M4 18c3-12 13-12 16 0"/><path d="M6 7h12"/><circle cx="6" cy="7" r="1.5"/><circle cx="18" cy="7" r="1.5"/><circle cx="12" cy="7" r="2"/>',
    straight: '<path d="M4 18L20 6"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="4" width="4" height="4"/>',
    add: '<path d="M3 17c4-10 14-10 18 0"/><path d="M12 3v6M9 6h6"/>',
    del: '<path d="M3 17c4-10 14-10 18 0"/><path d="M9 6h6"/>',
    "break": '<path d="M3 17c2-6 5-8 7-9M21 17c-2-6-5-8-7-9"/><path d="M12 3v3M12 11v2"/>',
    join: '<path d="M3 17c2-6 5-8 9-9 4 1 7 3 9 9"/><rect x="10" y="6" width="4" height="4"/>',
    closeP: '<path d="M6 18L4 9l8-5 8 5-2 9z"/>',
    openP: '<path d="M8 19L4 9l8-5 8 5-2 9"/>',
    undoPt: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    done: '<path d="M5 12l5 5 9-10"/>',
    cancel: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  var NODE_R = 4.5, HANDLE_R = 3.5, HIT = 10, HIT_TOUCH = 22, MOVE_MIN = 3, MOVE_MIN_TOUCH = 8, DBL_MS = 400;

  function session(host, opts) {
    opts = opts || {};
    var S = { mode: opts.mode === "pen" ? "pen" : "nodes", paths: opts.mode === "pen" ? [] : V.fromCmds(opts.cmds || []) };
    var sel = {};                 // "pi:ni" → 1
    var drag = null, hover = null, marquee = null, lastDown = { t: 0, x: 0, y: 0 }, barEl = null, open = true;

    function key(pi, ni) { return pi + ":" + ni; }
    function selList() {
      return Object.keys(sel).map(function (k) { var a = k.split(":"); return { pi: +a[0], ni: +a[1] }; })
        .filter(function (e) { return S.paths[e.pi] && S.paths[e.pi].n[e.ni]; });
    }
    function scr(x, y) { return host.toScreen(x, y); }
    function scale() {
      var a = scr(0, 0), b = scr(1, 0);
      return Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    }
    function changed() { host.redraw(); refreshBar(); }

    // ---------- hits (screen space) ----------
    function visibleHandles() {
      var out = [], seen = {};
      function push(pi, ni, which) {
        var p = S.paths[pi], n = p && p.n[ni];
        if (!n || seen[pi + ":" + ni + which]) return;
        var hx = which === "i" ? n.ix : n.ox, hy = which === "i" ? n.iy : n.oy;
        if (Math.hypot(hx - n.x, hy - n.y) < 1e-3) return;
        if (!p.closed && ((which === "i" && ni === 0) || (which === "o" && ni === p.n.length - 1))) return;
        seen[pi + ":" + ni + which] = 1;
        out.push({ pi: pi, ni: ni, which: which, x: hx, y: hy, ax: n.x, ay: n.y });
      }
      selList().forEach(function (e) {
        var p = S.paths[e.pi], L = p.n.length;
        push(e.pi, e.ni, "i"); push(e.pi, e.ni, "o");
        var prev = e.ni > 0 ? e.ni - 1 : p.closed ? L - 1 : -1, next = e.ni < L - 1 ? e.ni + 1 : p.closed ? 0 : -1;
        if (prev >= 0) push(e.pi, prev, "o");
        if (next >= 0) push(e.pi, next, "i");
      });
      return out;
    }
    function hitHandle(sx, sy, touch) {
      var r = touch ? HIT_TOUCH : HIT, best = null, bd = r;
      visibleHandles().forEach(function (h) {
        var q = scr(h.x, h.y), d = Math.hypot(q[0] - sx, q[1] - sy);
        if (d <= bd) { bd = d; best = h; }
      });
      return best;
    }
    function hitNode(sx, sy, touch) {
      var r = touch ? HIT_TOUCH : HIT, best = null, bd = r;
      S.paths.forEach(function (p, pi) {
        p.n.forEach(function (n, ni) {
          var q = scr(n.x, n.y), d = Math.hypot(q[0] - sx, q[1] - sy);
          if (d <= bd) { bd = d; best = { pi: pi, ni: ni }; }
        });
      });
      return best;
    }
    function hitSeg(sx, sy, touch) {
      var p = host.toSpace(sx, sy), q = V.nearest(S.paths, p[0], p[1]);
      if (!q) return null;
      return q.d * scale() <= (touch ? HIT_TOUCH : HIT) ? q : null;
    }

    // ---------- writing ----------
    var began = false;
    function begin() { if (!began) { began = true; host.begin(); } }
    function finishStep() { if (began) { began = false; host.end(); } }
    // Apply the paths; a refusal (too many points) puts back `prev`.
    function apply(prev) {
      if (host.set(S.paths) === false) {
        if (prev) S.paths = prev;
        host.say(tr("pe.tooBig"));
        return false;
      }
      return true;
    }
    function step(fn) {
      var prev = V.clone(S.paths);
      if (fn() === false) return;
      begin();
      apply(prev);
      finishStep();
      changed();
    }

    // ---------- pen ----------
    function penPath() { return S.paths[0]; }
    function penFinish(closed) {
      var p = penPath();
      if (!p || p.n.length < 2 || (closed && p.n.length < 2)) { host.say(tr("pe.min")); return; }
      if (closed) V.setClosed(S.paths, 0, true);
      var out = V.clone(S.paths);
      if (host.create(out) === false) { host.say(tr("pe.tooBig")); return; }
      end();
    }
    function penDown(ev) {
      var p = penPath(), pt = host.toSpace(ev.sx, ev.sy);
      if (p && p.n.length) {
        var f = scr(p.n[0].x, p.n[0].y), l = p.n[p.n.length - 1], ls = scr(l.x, l.y), r = ev.touch ? HIT_TOUCH : HIT;
        if (p.n.length >= 2 && Math.hypot(f[0] - ev.sx, f[1] - ev.sy) <= r) { penFinish(true); return true; }
        if (p.n.length >= 2 && Math.hypot(ls[0] - ev.sx, ls[1] - ev.sy) <= r) { penFinish(false); return true; }
        if (ev.shift) {                                    // 45° from the last point
          var dx = pt[0] - l.x, dy = pt[1] - l.y, len = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          pt = [l.x + Math.cos(a) * len, l.y + Math.sin(a) * len];
        }
      }
      if (V.count(S.paths) >= V.MAX_NODES) { host.say(tr("pe.tooBig")); return true; }
      if (!p) { p = { closed: false, n: [] }; S.paths.push(p); }
      p.n.push({ x: pt[0], y: pt[1], ix: pt[0], iy: pt[1], ox: pt[0], oy: pt[1], k: "c" });
      drag = { kind: "pen", sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch };
      changed();
      return true;
    }

    // ---------- nodes ----------
    function nodesDown(ev) {
      var now = Date.now();
      var dbl = now - lastDown.t < DBL_MS && Math.hypot(ev.sx - lastDown.x, ev.sy - lastDown.y) < 16;
      lastDown = { t: now, x: ev.sx, y: ev.sy };
      var h = hitHandle(ev.sx, ev.sy, ev.touch);
      if (h) {
        drag = { kind: "handle", h: h, sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch, prev: V.clone(S.paths) };
        return true;
      }
      var nd = hitNode(ev.sx, ev.sy, ev.touch);
      if (nd) {
        var k = key(nd.pi, nd.ni);
        if (ev.shift) { if (sel[k]) delete sel[k]; else sel[k] = 1; changed(); drag = { kind: "none", sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch }; return true; }
        if (!sel[k]) { sel = {}; sel[k] = 1; changed(); }
        drag = { kind: "nodes", sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch, start: V.clone(S.paths), p0: host.toSpace(ev.sx, ev.sy) };
        return true;
      }
      var sg = hitSeg(ev.sx, ev.sy, ev.touch);
      if (sg && dbl) {
        step(function () {
          var ni = V.split(S.paths, sg.pi, sg.si, sg.t);
          if (ni < 0) return false;
          if (V.count(S.paths) > V.MAX_NODES) return false;
          sel = {}; sel[key(sg.pi, ni)] = 1;
        });
        drag = { kind: "none", sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch };
        return true;
      }
      if (sg) { drag = { kind: "tapSeg", sx: ev.sx, sy: ev.sy, moved: false, touch: ev.touch }; return true; }
      if (ev.touch) return false;                          // the app pans
      drag = { kind: "marquee", sx: ev.sx, sy: ev.sy, moved: false, add: ev.shift ? Object.assign({}, sel) : {} };
      return true;
    }

    function moveNodes(ev) {
      var p = host.toSpace(ev.sx, ev.sy), dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      var st = drag.start;
      S.paths = V.clone(st);
      selList().forEach(function (e) {
        var n = S.paths[e.pi].n[e.ni];
        n.x += dx; n.y += dy; n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy;
      });
      begin();
      apply(V.clone(st));
    }
    function moveHandleTo(ev) {
      var p = host.toSpace(ev.sx, ev.sy), h = drag.h, n = S.paths[h.pi] && S.paths[h.pi].n[h.ni];
      if (!n) return;
      var prev = V.clone(S.paths);
      V.moveHandle(n, h.which, p[0], p[1], ev.alt);
      begin();
      apply(prev);
    }

    // ---------- events ----------
    S.down = function (ev) {
      if (!open) return false;
      hover = null;
      return S.mode === "pen" ? penDown(ev) : nodesDown(ev);
    };
    S.move = function (ev) {
      if (!open) return false;
      if (!drag) {
        if (S.mode === "pen" && !ev.touch) { hover = host.toSpace(ev.sx, ev.sy); host.redraw(); return true; }
        return false;
      }
      if (!drag.moved && Math.hypot(ev.sx - drag.sx, ev.sy - drag.sy) < (drag.touch ? MOVE_MIN_TOUCH : MOVE_MIN)) return true;
      drag.moved = true;
      if (drag.kind === "pen") {
        var p = penPath(), n = p.n[p.n.length - 1], q = host.toSpace(ev.sx, ev.sy);
        n.ox = q[0]; n.oy = q[1];
        n.ix = 2 * n.x - q[0]; n.iy = 2 * n.y - q[1];
        n.k = "y";
        if (p.n.length === 1) { n.ix = n.x; n.iy = n.y; n.k = "c"; }
      } else if (drag.kind === "nodes") moveNodes(ev);
      else if (drag.kind === "handle") moveHandleTo(ev);
      else if (drag.kind === "marquee") {
        marquee = { x0: drag.sx, y0: drag.sy, x1: ev.sx, y1: ev.sy };
        var x0 = Math.min(drag.sx, ev.sx), x1 = Math.max(drag.sx, ev.sx), y0 = Math.min(drag.sy, ev.sy), y1 = Math.max(drag.sy, ev.sy);
        sel = Object.assign({}, drag.add);
        S.paths.forEach(function (pp, pi) {
          pp.n.forEach(function (n, ni) { var s = scr(n.x, n.y); if (s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1) sel[key(pi, ni)] = 1; });
        });
        refreshBar();
      }
      host.redraw();
      return true;
    };
    S.up = function (ev) {
      if (!open) return false;
      var d = drag;
      drag = null; marquee = null;
      if (!d) return false;
      if (d.kind === "nodes" || d.kind === "handle") finishStep();
      if (!d.moved && (d.kind === "tapSeg" || d.kind === "marquee")) { sel = {}; }
      if (d.kind === "pen" && ev && !ev.touch) hover = host.toSpace(ev.sx, ev.sy);
      changed();
      return true;
    };
    S.tapEmpty = function () {
      if (!open) return;
      if (S.mode === "nodes" && Object.keys(sel).length) { sel = {}; changed(); return; }
      if (S.mode === "nodes") end();
    };

    S.key = function (e) {
      if (!open) return false;
      var k = e.key;
      if (k === "Escape") {
        if (S.mode === "nodes" && Object.keys(sel).length) { sel = {}; changed(); }
        else end();
        return true;
      }
      if (k === "Enter") { if (S.mode === "pen") penFinish(false); else end(); return true; }
      if (k === "Delete" || k === "Backspace") { S.act(S.mode === "pen" ? "undoPt" : "del"); return true; }
      var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[k] && S.mode === "nodes" && selList().length) {
        var st = e.shiftKey ? 10 : 1, v = arrows[k];
        step(function () {
          selList().forEach(function (q) {
            var n = S.paths[q.pi].n[q.ni];
            n.x += v[0] * st; n.y += v[1] * st; n.ix += v[0] * st; n.iy += v[1] * st; n.ox += v[0] * st; n.oy += v[1] * st;
          });
        });
        return true;
      }
      return false;
    };

    // ---------- actions ----------
    function oneOpenEnds() {
      var l = selList();
      return l.length === 2 && V.isEnd(S.paths, l[0]) && V.isEnd(S.paths, l[1]) && !(l[0].pi === l[1].pi && S.paths[l[0].pi].n.length < 3);
    }
    function targetPath() {
      var l = selList();
      if (l.length) { var pi = l[0].pi; return l.every(function (e) { return e.pi === pi; }) ? pi : -1; }
      return S.paths.length === 1 ? 0 : -1;
    }
    S.actions = function () {
      if (S.mode === "pen") {
        var n = penPath() ? penPath().n.length : 0;
        return [
          { id: "undoPt", label: tr("pe.undoPt"), icon: "undoPt", disabled: n < 1 },
          { id: "closeP", label: tr("pe.close"), icon: "closeP", disabled: n < 3 },
          { id: "done", label: tr("pe.done"), icon: "done", disabled: n < 2, primary: true },
          { id: "cancel", label: tr("pe.cancel"), icon: "cancel" }
        ];
      }
      var l = selList(), none = !l.length;
      function all(k) { return !none && l.every(function (e) { return (S.paths[e.pi].n[e.ni].k || "c") === k; }); }
      var tp = targetPath(), closed = tp >= 0 && S.paths[tp].closed;
      var brk = l.length === 1 && (S.paths[l[0].pi].closed || (l[0].ni > 0 && l[0].ni < S.paths[l[0].pi].n.length - 1));
      return [
        { id: "done", label: tr("pe.done"), icon: "done", primary: true },
        { id: "corner", label: tr("pe.corner"), icon: "corner", on: all("c"), disabled: none },
        { id: "smooth", label: tr("pe.smooth"), icon: "smooth", on: all("s"), disabled: none },
        { id: "sym", label: tr("pe.sym"), icon: "sym", on: all("y"), disabled: none },
        { id: "straight", label: tr("pe.straight"), icon: "straight", disabled: none },
        { id: "add", label: tr("pe.add"), icon: "add", disabled: none },
        { id: "del", label: tr("pe.del"), icon: "del", disabled: none },
        { id: "break", label: tr("pe.break"), icon: "break", disabled: !brk },
        { id: "join", label: tr("pe.join"), icon: "join", disabled: !oneOpenEnds() },
        { id: "closeP", label: closed ? tr("pe.open") : tr("pe.close"), icon: closed ? "openP" : "closeP", disabled: tp < 0 || (!closed && S.paths[tp].n.length < 2) }
      ];
    };

    S.act = function (id) {
      if (!open) return;
      if (S.mode === "pen") {
        var p = penPath();
        if (id === "undoPt") { if (p && p.n.length) { p.n.pop(); if (!p.n.length) S.paths = []; changed(); } return; }
        if (id === "closeP") { penFinish(true); return; }
        if (id === "done") { penFinish(false); return; }
        if (id === "cancel") { end(); return; }
        return;
      }
      var l = selList();
      if (id === "done") { end(); return; }
      if (id === "corner" || id === "smooth" || id === "sym") {
        var kk = id === "corner" ? "c" : id === "smooth" ? "s" : "y";
        step(function () { if (!l.length) return false; l.forEach(function (e) { V.setKind(S.paths, e.pi, e.ni, kk); }); });
        return;
      }
      if (id === "straight") { step(function () { if (!l.length) return false; l.forEach(function (e) { V.straight(S.paths[e.pi].n[e.ni]); }); }); return; }
      if (id === "add") {
        step(function () {
          if (!l.length) return false;
          // the segments whose two ends are selected, else the one after
          // each selected point (before it at the end of an open path)
          var bySeg = [];
          S.paths.forEach(function (p, pi) {
            V.segsOf(p).forEach(function (s, si) { if (sel[key(pi, s[0])] && sel[key(pi, s[1])]) bySeg.push({ pi: pi, si: si }); });
          });
          if (!bySeg.length) {
            l.forEach(function (e) {
              var p = S.paths[e.pi], segs = V.segsOf(p);
              for (var si = 0; si < segs.length; si++) if (segs[si][0] === e.ni) { bySeg.push({ pi: e.pi, si: si }); return; }
              for (var sj = 0; sj < segs.length; sj++) if (segs[sj][1] === e.ni) { bySeg.push({ pi: e.pi, si: sj }); return; }
            });
          }
          if (!bySeg.length || V.count(S.paths) + bySeg.length > V.MAX_NODES) return false;
          // from the last segment back, so earlier indexes stay right
          bySeg.sort(function (a, b) { return a.pi - b.pi || b.si - a.si; });
          var made = [];
          bySeg.forEach(function (s) { made.push({ pi: s.pi, ni: V.split(S.paths, s.pi, s.si, 0.5) }); });
          sel = {};
          made.forEach(function (m) { if (m.ni >= 0) sel[key(m.pi, m.ni)] = 1; });
        });
        return;
      }
      if (id === "del") {
        if (!l.length) return;
        var left = V.removeNodes(S.paths, sel);
        if (!left) { host.say(tr("pe.min")); return; }
        step(function () { S.paths = left; sel = {}; });
        return;
      }
      if (id === "break") {
        if (l.length !== 1) return;
        step(function () { if (!V.breakAt(S.paths, l[0].pi, l[0].ni)) return false; sel = {}; });
        return;
      }
      if (id === "join") {
        if (!oneOpenEnds()) return;
        step(function () { if (!V.join(S.paths, l[0], l[1])) return false; sel = {}; });
        return;
      }
      if (id === "closeP") {
        var tp = targetPath();
        if (tp < 0) return;
        step(function () { if (!V.setClosed(S.paths, tp, !S.paths[tp].closed)) return false; sel = {}; });
      }
    };

    // Take a new outline from the document (undo, an edit elsewhere);
    // the selection stays when the points are the same in number.
    S.reload = function (cmds) {
      var np = V.fromCmds(cmds || []);
      if (V.count(np) !== V.count(S.paths)) sel = {};
      S.paths = np;
      changed();
    };

    function end() {
      if (!open) return;
      open = false;
      finishStep();
      drag = null; marquee = null; hover = null;
      if (barEl) { barEl.innerHTML = ""; barEl.hidden = true; }
      host.exit();
    }
    S.cancel = end;
    S.isOpen = function () { return open; };
    S.selected = function () { return selList(); };
    S.select = function (list) { sel = {}; (list || []).forEach(function (e) { sel[key(e.pi, e.ni)] = 1; }); changed(); };

    // ---------- drawing (screen space) ----------
    S.paint = function (ctx) {
      if (!open) return;
      var acc = host.accent || "#4da3ff";
      ctx.save();
      ctx.lineWidth = 1.5; ctx.strokeStyle = acc; ctx.setLineDash([]);
      S.paths.forEach(function (p) {
        if (!p.n.length) return;
        ctx.beginPath();
        var a = scr(p.n[0].x, p.n[0].y);
        ctx.moveTo(a[0], a[1]);
        V.segsOf(p).forEach(function (s) {
          var c = V.bez(p, s), q1 = scr(c[2], c[3]), q2 = scr(c[4], c[5]), q3 = scr(c[6], c[7]);
          ctx.bezierCurveTo(q1[0], q1[1], q2[0], q2[1], q3[0], q3[1]);
        });
        ctx.stroke();
      });
      // the pen's next segment
      var pp = S.mode === "pen" ? penPath() : null;
      if (pp && pp.n.length && hover && !drag) {
        var l = pp.n[pp.n.length - 1], s0 = scr(l.x, l.y), so = scr(l.ox, l.oy), h = scr(hover[0], hover[1]);
        ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.bezierCurveTo(so[0], so[1], h[0], h[1], h[0], h[1]); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      // handles
      var hs = S.mode === "pen" ? penHandles() : visibleHandles();
      ctx.lineWidth = 1;
      hs.forEach(function (hh) {
        var a = scr(hh.ax, hh.ay), b = scr(hh.x, hh.y);
        ctx.strokeStyle = acc;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.fillStyle = acc;
        ctx.beginPath(); ctx.arc(b[0], b[1], HANDLE_R, 0, Math.PI * 2); ctx.fill();
      });
      // points
      S.paths.forEach(function (p, pi) {
        p.n.forEach(function (n, ni) {
          var q = scr(n.x, n.y), on = !!sel[key(pi, ni)], r = NODE_R;
          ctx.fillStyle = on ? acc : "#ffffff"; ctx.strokeStyle = acc; ctx.lineWidth = 1.5;
          ctx.beginPath();
          if ((n.k || "c") === "c") ctx.rect(q[0] - r, q[1] - r, 2 * r, 2 * r);
          else ctx.arc(q[0], q[1], r + 0.5, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          if (S.mode === "pen" && ni === 0 && p.n.length >= 2) {   // the point that closes the shape
            ctx.beginPath(); ctx.arc(q[0], q[1], r + 4, 0, Math.PI * 2); ctx.stroke();
          }
        });
      });
      if (marquee) {
        ctx.fillStyle = "rgba(77,163,255,0.12)"; ctx.strokeStyle = acc; ctx.lineWidth = 1;
        var mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1), mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
        ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh);
      }
      ctx.restore();
    };
    function penHandles() {
      var p = penPath(), out = [];
      if (!p || !p.n.length) return out;
      var n = p.n[p.n.length - 1];
      if (Math.hypot(n.ox - n.x, n.oy - n.y) > 1e-3) out.push({ x: n.ox, y: n.oy, ax: n.x, ay: n.y });
      if (p.n.length > 1 && Math.hypot(n.ix - n.x, n.iy - n.y) > 1e-3) out.push({ x: n.ix, y: n.iy, ax: n.x, ay: n.y });
      return out;
    }

    // ---------- the bar ----------
    function refreshBar() {
      if (!barEl || !open) return;
      var doc = barEl.ownerDocument;
      barEl.innerHTML = "";
      barEl.hidden = false;
      barEl.setAttribute("role", "toolbar");
      barEl.setAttribute("aria-label", tr(S.mode === "pen" ? "pe.pen" : "pe.bar"));
      S.actions().forEach(function (a) {
        var b = doc.createElement("button");
        b.type = "button";
        b.className = "pe-b" + (a.on ? " on" : "") + (a.primary ? " primary" : "");
        b.disabled = !!a.disabled;
        b.title = a.label;
        b.setAttribute("aria-label", a.label);
        if (a.on !== undefined) b.setAttribute("aria-pressed", a.on ? "true" : "false");
        b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[a.icon] || "") + "</svg>";
        var sp = doc.createElement("span");
        sp.className = "pe-l";
        sp.textContent = a.label;
        b.appendChild(sp);
        b.addEventListener("click", function () { S.act(a.id); });
        barEl.appendChild(b);
      });
    }
    S.bar = function (el) { barEl = el; refreshBar(); };

    return S;
  }

  var api = { session: session, STR: STR, str: tr, ICON: ICON };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.orosDK = root.orosDK || {}; root.orosDK.pathedit = api; }
})(typeof window !== "undefined" ? window : this);
