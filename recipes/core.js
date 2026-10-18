// ============================================================
// orOS recipes — core.js: automations without code (v1.0.0)
// An automation ("recipe") is a named list of steps, kept as DATA,
// never code: each app has a catalog of the steps it knows, and a
// step whose op or arguments its catalog does not accept is never
// run. Catalogs: atelier/recipesteps.js, layout/recipesteps.js,
// photolab/recipesteps.js (the last two through recipes/ui.js).
// Synced slice "recipes" (oros-recipes), one record for every app:
//   { ver: 1,
//     list: [{ id "rc-…", m, app, nm, steps[{ op, …args }], pos }] ≤ 200
//     dt:   { id: m }   tombstones of removed recipes }
// The slice keeps steps it cannot check (an op from a newer orOS)
// byte for byte: JSON values only, keys sorted, capped, so a device
// running older code never strips a newer device's steps (the
// lesson of designkit K1). check() is what decides what may run.
// Merge: per recipe the newer m wins (equal m: the larger canonical
// JSON); a tombstone removes recipes not newer than it.
// Pure: no DOM. Exposes window.orosRecipes (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1, MAX = 200, MAX_STEPS = 40, MAX_NAME = 80, MAX_BYTES = 20000;
  var ID = /^rc-[a-z0-9]{6,24}$/, APP = /^[a-z][a-z0-9]{1,23}$/, OP = /^[a-z][a-zA-Z0-9]{0,30}$/;
  var KEY = /^[a-z][a-zA-Z0-9]{0,30}$/;
  var COLOR = /^#[0-9a-f]{6}$/;
  var FONT = /^(sans|serif|mono|fs_[a-z0-9]+(_[a-z0-9]+)*)$/;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function stamp(v) { return isNum(v) && v > 0 ? Math.floor(v) : 0; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function clean(s, max) { return typeof s === "string" ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max) : ""; }

  // ---------- 1. Plain JSON, kept as it is ----------
  // A JSON value with sorted keys, or undefined when it is not one
  // (functions, NaN, too deep).
  function plain(v, depth) {
    if (depth > 6) return undefined;
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return isFinite(v) ? v : undefined;
    if (typeof v === "string") return clean(v, 5000);
    if (Array.isArray(v)) {
      var a = [];
      for (var i = 0; i < v.length && i < 100; i++) { var x = plain(v[i], depth + 1); if (x === undefined) return undefined; a.push(x); }
      return a;
    }
    if (typeof v === "object") {
      var o = {}, keys = Object.keys(v).sort();
      for (var j = 0; j < keys.length && j < 40; j++) {
        if (!KEY.test(keys[j])) return undefined;
        var y = plain(v[keys[j]], depth + 1);
        if (y === undefined) return undefined;
        o[keys[j]] = y;
      }
      return o;
    }
    return undefined;
  }
  function rawStep(s) {
    if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.op !== "string" || !OP.test(s.op)) return null;
    var o = plain(s, 0);
    return o && typeof o === "object" ? o : null;
  }

  function normRecipe(x) {
    if (!x || typeof x !== "object" || !ID.test(x.id) || !APP.test(x.app)) return null;
    var m = stamp(x.m);
    if (!m) return null;
    var steps = [];
    (Array.isArray(x.steps) ? x.steps : []).slice(0, MAX_STEPS).forEach(function (s) {
      var r = rawStep(s);
      if (r) steps.push(r);
    });
    var o = { id: x.id, m: m, app: x.app, nm: clean(x.nm, MAX_NAME).trim(), steps: steps, pos: isNum(x.pos) ? Math.round(x.pos * 1000) / 1000 : 0 };
    if (JSON.stringify(o).length > MAX_BYTES) return null;
    return o;
  }

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  function byPos(a, b) { return a.pos - b.pos || cmp(a.id, b.id); }

  // merge(a, b) with b optional: also the normalizer
  function merge(A, B) {
    var a = A && typeof A === "object" ? A : {}, b = B && typeof B === "object" ? B : {};
    var dt = {};
    [a.dt, b.dt].forEach(function (t) {
      if (!t || typeof t !== "object") return;
      Object.keys(t).forEach(function (id) {
        var m = stamp(t[id]);
        if (ID.test(id) && m) dt[id] = Math.max(dt[id] || 0, m);
      });
    });
    var by = {};
    [a.list, b.list].forEach(function (l) {
      (Array.isArray(l) ? l : []).forEach(function (x) {
        var r = normRecipe(x);
        if (r) by[r.id] = newer(by[r.id], r);
      });
    });
    var list = Object.keys(by).map(function (id) { return by[id]; })
      .filter(function (r) { return !(dt[r.id] >= r.m); }).sort(byPos).slice(0, MAX);
    var dto = {};
    Object.keys(dt).sort().forEach(function (id) { dto[id] = dt[id]; });
    return { ver: VER, list: list, dt: dto };
  }
  function empty() { return { ver: VER, list: [], dt: {} }; }

  // ---------- 2. Catalogs: what may run ----------
  // A catalog: { op: { args: { name: spec }, kind } } with spec
  //   { t: "str", max, req }   { t: "color", req }   { t: "font", req }
  //   { t: "num", lo, hi, def, req }   { t: "int", lo, hi, def }
  //   { t: "enum", v: [...], def }   { t: "bool", def }
  //   { t: "list", of: spec, min, max }   { t: "obj", f: { name: spec } }
  // arg() returns the clean value, or undefined (invalid / missing).
  function arg(spec, v) {
    switch (spec.t) {
      case "str":
        if (typeof v !== "string") return spec.req ? undefined : "";
        v = clean(v, spec.max || 500);
        return spec.req && !v ? undefined : v;
      case "color":
        v = typeof v === "string" ? v.toLowerCase() : "";
        if (COLOR.test(v)) return v;
        return spec.req ? undefined : "";
      case "font":
        if (typeof v === "string" && v.length <= 63 && FONT.test(v)) return v;
        return spec.req ? undefined : "";
      case "num": case "int":
        if (!isNum(v)) return spec.req ? undefined : spec.def;
        v = Math.min(spec.hi, Math.max(spec.lo, v));
        return spec.t === "int" ? Math.round(v) : Math.round(v * 100) / 100;
      case "enum":
        return spec.v.indexOf(v) >= 0 ? v : spec.def;
      case "bool":
        return v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : (spec.def ? 1 : 0);
      case "list":
        if (!Array.isArray(v)) return undefined;
        var out = [];
        for (var i = 0; i < v.length && out.length < (spec.max || 20); i++) {
          var x = arg(spec.of, v[i]);
          if (x !== undefined) out.push(x);
        }
        return out.length >= (spec.min || 0) ? out : undefined;
      case "obj":
        if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
        var o = {};
        var keys = Object.keys(spec.f);
        for (var k = 0; k < keys.length; k++) {
          var y = arg(spec.f[keys[k]], v[keys[k]]);
          if (y === undefined) return undefined;
          o[keys[k]] = y;
        }
        return o;
    }
    return undefined;
  }
  // One step through the catalog: { op, …args } in the catalog's
  // order, or null (unknown op, or a required argument missing).
  function normStep(s, catalog) {
    if (!s || typeof s !== "object" || typeof s.op !== "string" || !catalog || !Object.prototype.hasOwnProperty.call(catalog, s.op)) return null;
    var def = catalog[s.op], o = { op: s.op };
    var names = Object.keys(def.args || {});
    for (var i = 0; i < names.length; i++) {
      var v = arg(def.args[names[i]], s[names[i]]);
      if (v === undefined) return null;
      o[names[i]] = v;
    }
    return o;
  }
  // What of a recipe may run here: { steps: [clean steps], skipped: n }
  function check(recipe, catalog) {
    var steps = [], skipped = 0;
    ((recipe && recipe.steps) || []).forEach(function (s) {
      var c = normStep(s, catalog);
      if (c) steps.push(c); else skipped++;
    });
    return { steps: steps, skipped: skipped };
  }

  var rand = (function () {
    var c = root && root.crypto;
    return function (n) {
      var s = "", A = "abcdefghijklmnopqrstuvwxyz0123456789", b = new Uint8Array(n);
      if (c && c.getRandomValues) c.getRandomValues(b);
      else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
      for (var j = 0; j < n; j++) s += A[b[j] % 36];
      return s;
    };
  })();
  function newId() { return "rc-" + rand(12); }

  // The recipes of one app, in order.
  function ofApp(data, app) { return (data && data.list || []).filter(function (r) { return r.app === app; }); }

  var api = {
    VER: VER, MAX: MAX, MAX_STEPS: MAX_STEPS, MAX_NAME: MAX_NAME,
    normRecipe: normRecipe, merge: merge, empty: empty, arg: arg, normStep: normStep, check: check,
    newId: newId, ofApp: ofApp
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosRecipes = api;
})(typeof window !== "undefined" ? window : this);
