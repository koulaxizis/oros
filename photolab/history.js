// ============================================================
// orOS Photo Lab — undo / redo (no DOM)
// A stack of steps under a memory budget. A step is
//   { label, bytes, undo(), redo() }
// tileStep() builds one from tile snapshots taken before and after
// a change; docStep() from two copies of the document record (layer
// list, names, blend, offsets: no pixels). When the budget is full
// the OLDEST steps go and dropped() tells the caller (one hint).
// Session-only (R10): nothing here is stored.
//
// UMD: module.exports in Node (tests), window.PhotoLab.history in the app.
// ============================================================
(function (root) {
  "use strict";

  var DESKTOP_BUDGET = 256 * 1024 * 1024;
  var PHONE_BUDGET = 96 * 1024 * 1024;
  var MAX_STEPS = 200;

  function create(budget) {
    var past = [], future = [], dropped = 0;
    var cap = budget || DESKTOP_BUDGET;

    function used() {
      var n = 0;
      past.forEach(function (s) { n += s.bytes; });
      future.forEach(function (s) { n += s.bytes; });
      return n;
    }
    function trim() {
      while (past.length && (past.length > MAX_STEPS || used() > cap)) { past.shift(); dropped++; }
    }
    return {
      push: function (step) {
        if (!step) return;
        future = [];
        past.push(step);
        trim();
      },
      undo: function () {
        var s = past.pop();
        if (!s) return null;
        s.undo(); future.push(s);
        return s.label;
      },
      redo: function () {
        var s = future.pop();
        if (!s) return null;
        s.redo(); past.push(s);
        return s.label;
      },
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      // Labels oldest → newest, and how many of them are undone.
      list: function () {
        return { done: past.map(function (s) { return s.label; }),
                 undone: future.map(function (s) { return s.label; }).reverse() };
      },
      // Jump: undo or redo until `n` steps are done.
      goTo: function (n) {
        while (past.length > n && past.length) this.undo();
        while (past.length < n && future.length) this.redo();
      },
      used: used,
      dropped: function () { var d = dropped; dropped = 0; return d; },
      clear: function () { past = []; future = []; dropped = 0; }
    };
  }

  // surface: a tiles.js surface; before/after: tiles.snapshot() of the
  // same keys; onApply(): repaint hook.
  function tileStep(label, T, surface, before, after, onApply) {
    return {
      label: label,
      bytes: T.snapBytes(before) + T.snapBytes(after),
      undo: function () { T.restore(surface, before); if (onApply) onApply(); },
      redo: function () { T.restore(surface, after); if (onApply) onApply(); }
    };
  }

  // set(record): puts a document record back (layers, sizes, names).
  // extra: optional { undo(), redo(), bytes } for pixels that went
  // with the change (e.g. a deleted layer's surface kept alive).
  function docStep(label, beforeJson, afterJson, set, extra) {
    return {
      label: label,
      bytes: (beforeJson.length + afterJson.length) * 2 + (extra && extra.bytes || 0),
      undo: function () { if (extra && extra.undo) extra.undo(); set(JSON.parse(beforeJson)); },
      redo: function () { if (extra && extra.redo) extra.redo(); set(JSON.parse(afterJson)); }
    };
  }

  var API = {
    DESKTOP_BUDGET: DESKTOP_BUDGET, PHONE_BUDGET: PHONE_BUDGET, MAX_STEPS: MAX_STEPS,
    create: create, tileStep: tileStep, docStep: docStep
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.history = API; }
})(typeof window !== "undefined" ? window : this);
