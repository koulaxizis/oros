// ============================================================
// orOS Layout — working comfort (LY-N2, v1.0.0)
// The pure parts of N2, shared by the editor (editor.js), the
// panels (panels.js) and the tests:
//   - fmt(pt, unit): a length for the live measurements and the
//     rulers' read-outs, in the document's unit (mm, pt, in).
//   - spacing(box, others, axis, tol): smart guides for equal gaps.
//     box and others are {x, y, w, h} in one page's coordinates;
//     on axis "x" only the others that share some height with box
//     count (a row), on "y" those that share some width (a column).
//     Returns null or { d (move box by d on the axis), gap, marks
//     [{ a0, a1, at }] } where every mark is one equal gap (from a0
//     to a1 on the axis, at the cross-axis position `at`).
//   - describe(before, after): what one undo step did, for the named
//     undo history: { k, n, name }, k one of HIST_KEYS.
//   - ACTIONS, keymap(saved), comboOf(e), label(combo, mac), RESERVED:
//     the shortcuts a person may change (keys by e.code, so they work
//     with Greek or any other keyboard layout).
//   - nudge(unit, saved): the arrow-key step in pt.
// ============================================================
(function (root) {
  "use strict";

  var PT_PER = { pt: 1, mm: 72 / 25.4, in: 72 };
  var DEC = { mm: 1, pt: 1, in: 2 };

  function fmt(pt, unit) {
    var u = PT_PER[unit] ? unit : "mm", v = pt / PT_PER[u], p = Math.pow(10, DEC[u]);
    var r = Math.round(v * p) / p;
    if (Object.is(r, -0)) r = 0;
    return String(r) + " " + u;
  }

  // ---------- smart guides: equal spacing ----------
  function spacing(box, others, axis, tol) {
    var X = axis !== "y";
    function pos(b) { return X ? b.x : b.y; }
    function len(b) { return X ? b.w : b.h; }
    function end(b) { return pos(b) + len(b); }
    function c0(b) { return X ? b.y : b.x; }
    function c1(b) { return X ? b.y + b.h : b.x + b.w; }
    function shares(a, b) { return c0(a) < c1(b) - 0.01 && c0(b) < c1(a) - 0.01; }
    var row = (others || []).filter(function (o) { return o && o.w >= 0 && o.h >= 0 && shares(o, box); });
    if (!row.length) return null;
    row.sort(function (a, b) { return pos(a) - pos(b); });
    // the gaps already there, between neighbours of the row that also share a band
    var gaps = [];
    for (var i = 0; i + 1 < row.length; i++) {
      var a = row[i], b = row[i + 1], g = pos(b) - end(a);
      if (g > 0.5 && shares(a, b)) gaps.push({ g: g, a: a, b: b });
    }
    var mid = pos(box) + len(box) / 2, left = null, right = null;
    row.forEach(function (o) {
      if (end(o) <= mid && (!left || end(o) > end(left))) left = o;
      if (pos(o) >= mid && (!right || pos(o) < pos(right))) right = o;
    });
    var cands = [];
    gaps.forEach(function (gp) {
      if (left && gp.a !== left) cands.push({ to: end(left) + gp.g, gap: gp.g });
      if (right && gp.b !== right) cands.push({ to: pos(right) - gp.g - len(box), gap: gp.g });
    });
    if (left && right) {
      var g2 = (pos(right) - end(left) - len(box)) / 2;
      if (g2 > 0.5) cands.push({ to: end(left) + g2, gap: g2 });
    }
    var best = null;
    cands.forEach(function (c) {
      var d = c.to - pos(box);
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d: d, gap: c.gap };
    });
    if (!best) return null;
    // the marks: every gap of that size in the row, with the box in its new place
    var moved = { x: box.x, y: box.y, w: box.w, h: box.h };
    if (X) moved.x += best.d; else moved.y += best.d;
    var all = row.concat([moved]).sort(function (a, b) { return pos(a) - pos(b); }), marks = [];
    for (var k = 0; k + 1 < all.length; k++) {
      var p = all[k], q = all[k + 1], gg = pos(q) - end(p);
      if (Math.abs(gg - best.gap) <= 0.25 && shares(p, q)) {
        marks.push({ a0: end(p), a1: pos(q), at: (Math.max(c0(p), c0(q)) + Math.min(c1(p), c1(q))) / 2 });
      }
    }
    if (marks.length < 2) return null;
    best.marks = marks;
    return best;
  }

  // ---------- named undo history ----------
  var HIST_KEYS = ["add", "del", "move", "resize", "rotate", "change", "text", "style", "colour", "pages", "master", "setup", "guide", "edit"];
  var GEO = { x: "move", y: "move", w: "resize", h: "resize", rot: "rotate" };
  function strip(e) { var o = {}; Object.keys(e).forEach(function (k) { if (k !== "m") o[k] = e[k]; }); return JSON.stringify(o); }
  function delta(a, b) {
    var am = {}, bm = {}, out = { add: [], del: [], chg: [] };
    (a || []).forEach(function (e) { am[e.id] = e; });
    (b || []).forEach(function (e) { bm[e.id] = e; });
    Object.keys(bm).forEach(function (id) { if (!am[id]) out.add.push(bm[id]); else if (strip(am[id]) !== strip(bm[id])) out.chg.push([am[id], bm[id]]); });
    Object.keys(am).forEach(function (id) { if (!bm[id]) out.del.push(am[id]); });
    out.any = out.add.length + out.del.length + out.chg.length;
    return out;
  }
  function describe(before, after) {
    if (!before || !after) return { k: "edit", n: 0 };
    var parts = [];
    var it = delta(before.items, after.items);
    if (it.any) {
      if (it.add.length && !it.del.length && !it.chg.length) parts.push({ k: "add", n: it.add.length });
      else if (it.del.length && !it.add.length && !it.chg.length) parts.push({ k: "del", n: it.del.length });
      else if (it.chg.length && !it.add.length && !it.del.length) {
        var kinds = {};
        it.chg.forEach(function (p) {
          var A = p[0], B = p[1];
          Object.keys(Object.assign({}, A, B)).forEach(function (f) {
            if (f === "m" || JSON.stringify(A[f]) === JSON.stringify(B[f])) return;
            kinds[GEO[f] || "change"] = 1;
          });
        });
        var ks = Object.keys(kinds);
        // a resize often moves the frame too (a left or top handle)
        if (kinds.resize && !kinds.rotate && !kinds.change) ks = ["resize"];
        parts.push({ k: ks.length === 1 ? ks[0] : "change", n: it.chg.length });
      } else parts.push({ k: "edit", n: it.any });
    }
    var st = delta(before.stories, after.stories);
    if (st.any) parts.push({ k: "text", n: st.any });
    var ps = delta((before.pstyles || []).concat(before.cstyles || []), (after.pstyles || []).concat(after.cstyles || []));
    if (ps.any) {
      var one = ps.any === 1 ? (ps.chg[0] ? ps.chg[0][1] : ps.add[0] || ps.del[0]) : null;
      parts.push({ k: "style", n: ps.any, name: one && one.name ? one.name : "" });
    }
    if (delta(before.swatches, after.swatches).any) parts.push({ k: "colour", n: 1 });
    if (delta(before.pages, after.pages).any) parts.push({ k: "pages", n: 1 });
    if (delta(before.masters, after.masters).any) parts.push({ k: "master", n: 1 });
    if (JSON.stringify(before.setup) !== JSON.stringify(after.setup) || before.name !== after.name) parts.push({ k: "setup", n: 1 });
    if (delta(before.guides, after.guides).any) parts.push({ k: "guide", n: 1 });
    // typing in a frame changes the story only; a new text frame brings its story along
    if (parts.length === 2 && parts[0].k === "add" && parts[1].k === "text") parts = [parts[0]];
    if (parts.length === 2 && parts[0].k === "del" && parts[1].k === "text") parts = [parts[0]];
    if (parts.length === 1) return parts[0];
    if (!parts.length) return { k: "edit", n: 0 };
    return { k: "edit", n: parts.length };
  }

  // ---------- shortcuts ----------
  // [id, default combo, label key]; ids are stable (they are saved).
  var ACTIONS = [
    ["tool.select", "KeyV"], ["tool.text", "KeyT"], ["tool.image", "KeyF"], ["tool.rect", "KeyR"],
    ["tool.ell", "KeyE"], ["tool.line", "KeyL"], ["tool.pen", "KeyP"], ["tool.hand", "KeyH"],
    ["preview", "KeyW"], ["undo", "Mod+KeyZ"], ["redo", "Mod+Shift+KeyZ"], ["dup", "Mod+KeyD"],
    ["selall", "Mod+KeyA"], ["group", "Mod+KeyG"], ["ungroup", "Mod+Shift+KeyG"], ["export", "Mod+KeyE"],
    ["fit", "Mod+Digit0"], ["zoom100", "Mod+Digit1"], ["front", "Mod+Shift+BracketRight"], ["back", "Mod+Shift+BracketLeft"],
    ["fwd", "Mod+BracketRight"], ["bwd", "Mod+BracketLeft"], ["lock", ""], ["history", "Mod+Alt+KeyZ"],
    ["story", ""], ["keys", ""]
  ];
  // never taken by a changed shortcut: copy, cut, paste, the editing keys and orOS's own (Ctrl+Alt+Shift)
  var RESERVED = ["Mod+KeyC", "Mod+KeyX", "Mod+KeyV", "Escape", "Delete", "Backspace", "Enter", "Tab", "Space",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight", "Shift+ArrowUp", "Shift+ArrowDown",
    "Alt+ArrowLeft", "Alt+ArrowRight", "Alt+ArrowUp", "Alt+ArrowDown", "Shift+Enter", "Mod+Equal", "Mod+Minus", "Mod+NumpadAdd", "Mod+NumpadSubtract"];
  var COMBO_RE = /^(Mod\+)?(Alt\+)?(Shift\+)?[A-Z][A-Za-z0-9]{0,19}$/;
  function known(id) { return ACTIONS.some(function (a) { return a[0] === id; }); }
  function valid(c) { return c === "" || (COMBO_RE.test(c) && RESERVED.indexOf(c) < 0 && !/^(Mod\+)?(Alt\+)?(Shift\+)?(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(c)); }
  // the saved changes (only known actions, only valid combos), at most one action per combo
  function normKeys(saved) {
    var out = {};
    if (!saved || typeof saved !== "object") return out;
    Object.keys(saved).slice(0, 60).forEach(function (id) {
      var c = saved[id];
      if (known(id) && typeof c === "string" && valid(c)) out[id] = c;
    });
    return out;
  }
  function keymap(saved) {
    var mine = normKeys(saved), map = {};
    ACTIONS.forEach(function (a) { map[a[0]] = Object.prototype.hasOwnProperty.call(mine, a[0]) ? mine[a[0]] : a[1]; });
    // a changed shortcut wins over a default that used the same keys
    ACTIONS.forEach(function (a) {
      var c = map[a[0]];
      if (!c || Object.prototype.hasOwnProperty.call(mine, a[0])) return;
      Object.keys(mine).forEach(function (id) { if (id !== a[0] && mine[id] === c) map[a[0]] = ""; });
    });
    return map;
  }
  function lookup(map, combo) {
    if (!combo) return null;
    var hit = null;
    Object.keys(map).forEach(function (id) { if (!hit && map[id] === combo) hit = id; });
    return hit;
  }
  function comboOf(e) {
    var code = e && e.code;
    if (!code || /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code)) return null;
    // the number pad's digits count as the row's
    var m = /^Numpad(\d)$/.exec(code);
    if (m) code = "Digit" + m[1];
    return (e.ctrlKey || e.metaKey ? "Mod+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + code;
  }
  var KEYNAMES = { BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", Minus: "-", Equal: "=", Space: "Space" };
  function label(combo, mac) {
    if (!combo) return "";
    return combo.split("+").map(function (p) {
      if (p === "Mod") return mac ? "⌘" : "Ctrl";
      if (p === "Alt") return mac ? "⌥" : "Alt";
      if (p === "Shift") return mac ? "⇧" : "Shift";
      if (/^Key[A-Z]$/.test(p)) return p.slice(3);
      if (/^Digit\d$/.test(p)) return p.slice(5);
      return KEYNAMES[p] || p;
    }).join(mac ? "" : "+");
  }

  // ---------- arrow keys ----------
  var NUDGE = { mm: 0.5, pt: 1, in: 0.05 };
  function nudge(unit, saved) {
    var u = PT_PER[unit] ? unit : "mm", v = Number(saved);
    if (!(isFinite(v) && v > 0 && v <= 100)) v = NUDGE[u];
    return v * PT_PER[u];
  }

  var api = { PT_PER: PT_PER, fmt: fmt, spacing: spacing, HIST_KEYS: HIST_KEYS, describe: describe, ACTIONS: ACTIONS, RESERVED: RESERVED, valid: valid, normKeys: normKeys, keymap: keymap, lookup: lookup, comboOf: comboOf, label: label, NUDGE: NUDGE, nudge: nudge };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LY_SMART = api;
})(typeof window !== "undefined" ? window : this);
