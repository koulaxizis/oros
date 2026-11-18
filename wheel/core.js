// ============================================================
// orOS Wheel of Fate — pure model + slice merge (wheel/core.js)
// Since the 2026-11-13 merge 8 (APP-ALIAS "wheel" → Chance, tab
// "wheel") the wheel is a tab of the Chance app (dice/). The Chance
// page loads this file at boot so it can register the synced slice
// "wheel" (oros-wheel-data) before the tab's view (wheel/view.js) is
// loaded; the view uses the same functions. No DOM, no storage.
//   saved = { id, m (mtime, ms), name, opts[2..30], w? (weights) }
//   data  = { ver: 1, wheels: [saved…] sorted by id, tombs: { id: deletedAt } }
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1, MIN_OPTS = 2, MAX_OPTS = 30, OPT_LEN = 50, NAME_LEN = 40, MAX_W = 3;
  var DATA_KEY = "oros-wheel-data";

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // One option: text, spaces collapsed, ≤ 50. Empty ones drop out.
  function normOpt(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, OPT_LEN) : "";
  }
  function normOpts(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var o = normOpt(s);
      if (o && out.length < MAX_OPTS) out.push(o);
    });
    return out;
  }
  function normName(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }

  // Weights: { option text: 2 | 3 } (×1 is the default and is not
  // stored). Keyed by text, so moving, shuffling or deleting rows
  // needs no bookkeeping; equal texts share their weight. Canonical:
  // only texts on the wheel, in sorted order.
  function normW(map, opts) {
    var out = {}, m = map && typeof map === "object" ? map : {};
    var seen = {};
    (opts || []).slice().sort(cmpStr).forEach(function (o) {
      if (seen[o]) return;
      seen[o] = 1;
      var v = Object.prototype.hasOwnProperty.call(m, o) ? m[o] : 1;
      if (isInt(v) && v >= 2 && v <= MAX_W) out[o] = v;
    });
    return out;
  }
  function hasW(map) { return !!map && Object.keys(map).length > 0; }

  // saved = { id, m (mtime, ms), name, opts[2..30], w? (weights) }
  // data  = { ver: 1, wheels: [saved…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE = /^[a-z0-9]{6,40}$/;

  function normSaved(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normName(x.name), opts = normOpts(x.opts);
    if (!name || opts.length < MIN_OPTS) return null;
    var out = { id: x.id, m: x.m, name: name, opts: opts };
    var w = normW(x.w, opts);
    if (hasW(w)) out.w = w;
    return out;
  }

  // LWW per wheel (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects
  // (R17). Symmetric and canonical (R5, R26).
  function mergeWheel(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.wheels, b.wheels].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normSaved(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var wheels = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      wheels.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, wheels: wheels, tombs: sortedTombs };
  }

  var API = {
    DATA_KEY: DATA_KEY, DATA_VER: DATA_VER, MIN_OPTS: MIN_OPTS, MAX_OPTS: MAX_OPTS,
    OPT_LEN: OPT_LEN, NAME_LEN: NAME_LEN, MAX_W: MAX_W,
    cmpStr: cmpStr, isInt: isInt, normOpt: normOpt, normOpts: normOpts, normName: normName,
    normW: normW, hasW: hasW, normSaved: normSaved, mergeWheel: mergeWheel
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.WheelCore = API;
})(typeof window !== "undefined" ? window : null);
