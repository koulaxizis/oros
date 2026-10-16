// ============================================================
// orOS Meal Planner — .orosmeals file (meals/package.js,
// window.OrosMealsPackage). The descriptor of the Meal Planner for
// the record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): the recipes, the plan, the shopping ticks and own items,
// the pantry and the "always at home" choices in one orOS bundle;
// opening one ADDS what this device lacks, with its ids. Pure (no
// DOM, no storage), so the app and `node --test` run the same code.
// Needs core.js (window.OrosMealsCore; require("./core.js") under Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; meals.js then runs the result
//                            through its own commit, i.e. mergeMeals)
//   DESC.norm(data)          a file's data → the slice through core.js
//                            mergeMeals (its own record checks), sizes
//                            capped first, and plan days, ticks and own
//                            items more than FUTURE_DAYS ahead dropped
//                            (a far-future day would make mergeMeals
//                            prune this device's older days)
//   DESC.strip(state)        the slice → { ver, rc, pl, ck, mn, pa, pn }:
//                            no tombstones; no settings (set: diet,
//                            slots, week start), aisle choices (ai) or
//                            nutrition matches (nu): they have no
//                            "removed" form, so Undo could not take
//                            them back, and sync carries them anyway
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  recipes.md (every stored recipe as text)
//   forLocal(getLocal, fmt)  DESC for the app: at most as many new
//                            recipes / pantry items as fit under the
//                            app's limits; fmt { recipe(r) → text,
//                            shop() → text } gives the previews the
//                            app's own wording (recipeText, shopAsText)
//                            and adds shopping.txt
//   asCopy(getLocal, fmt, makeId)  "Open as copy": the recipes only,
//                            each under a FRESH id (recipes work like
//                            templates), stamped now, so even recipes
//                            already here come in again as new ones
//   COLLS                    the collection paths of DESC
// ============================================================
(function (root) {
  "use strict";

  var C = root && root.OrosMealsCore;
  if (!C && typeof require === "function") C = require("./core.js").OrosMealsCore;

  var FUTURE_DAYS = 92;                  // plan days later than today + this are dropped
  var IN = { rc: 2000, mn: 5000, pa: 5000, pl: 20000, ck: 50000, pn: 5000 };   // read at most
  var DAY_MS = 86400000;
  var COLLS = ["rc", "pl", "ck", "mn", "pa", "pn"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function ymdOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function firstKeys(o, n) {
    var out = {}, keys = Object.keys(o).slice(0, n);
    keys.forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  // The day a plan cell or tick key starts with ("YYYY-MM-DD|…").
  function keyDay(k) { return typeof k === "string" ? k.slice(0, 10) : ""; }

  function norm(data, now) {
    if (!isObj(data)) return null;
    var last = ymdOf((typeof now === "number" ? now : Date.now()) + FUTURE_DAYS * DAY_MS);
    var raw = { ver: C.DATA_VER, rc: [], pl: {}, ck: {}, mn: [], pa: [], pn: {}, tombs: {} };
    if (Array.isArray(data.rc)) raw.rc = data.rc.slice(0, IN.rc);
    if (Array.isArray(data.mn)) raw.mn = data.mn.slice(0, IN.mn).filter(function (x) { return isObj(x) && typeof x.w === "string" && x.w <= last; });
    if (Array.isArray(data.pa)) raw.pa = data.pa.slice(0, IN.pa);
    ["pl", "ck"].forEach(function (k) {
      if (!isObj(data[k])) return;
      var o = firstKeys(data[k], IN[k]);
      Object.keys(o).forEach(function (key) { if (keyDay(key) <= last) raw[k][key] = o[key]; });
    });
    if (isObj(data.pn)) raw.pn = firstKeys(data.pn, IN.pn);
    if (isObj(data.tombs)) raw.tombs = firstKeys(data.tombs, IN.rc + IN.mn + IN.pa);
    // core.js's own checks: typed and capped records, valid keys, and a
    // record the file itself deleted (its tomb) left out
    var m = C.mergeMeals(raw, {});
    var out = { ver: m.ver, rc: m.rc.slice(0, C.LIM.recipes), pl: m.pl, ck: m.ck, mn: m.mn, pa: m.pa, pn: m.pn };
    if (Object.keys(m.tombs).length) out.tombs = m.tombs;   // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({
      ver: C.DATA_VER,
      rc: Array.isArray(s.rc) ? s.rc : [], pl: isObj(s.pl) ? s.pl : {}, ck: isObj(s.ck) ? s.ck : {},
      mn: Array.isArray(s.mn) ? s.mn : [], pa: Array.isArray(s.pa) ? s.pa : [], pn: isObj(s.pn) ? s.pn : {}
    }));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  var WORDS = {
    en: { title: "Recipes", serv: "{n} servings", ings: "Ingredients", steps: "Steps", src: "Source" },
    el: { title: "Συνταγές", serv: "{n} μερίδες", ings: "Υλικά", steps: "Εκτέλεση", src: "Πηγή" }
  };
  // One recipe as plain text, in the words of the app's "Copy" (meals.js
  // recipeText), for when the app gives no formatter (Node).
  function recipeTextOf(r, lang) {
    var w = WORDS[lang === "el" ? "el" : "en"];
    var out = [(r.e ? r.e + " " : "") + r.t, w.serv.replace("{n}", r.sv), "", w.ings + ":"];
    var g = "";
    (r.ig || []).forEach(function (ing) {
      if (ing.g && ing.g !== g) { g = ing.g; out.push(g + ":"); }
      out.push("- " + C.ingToLine(ing, lang === "el" ? "el" : "en", 1, ""));
    });
    if (r.st && r.st.length) {
      out.push("", w.steps + ":");
      r.st.forEach(function (s, i) { out.push((i + 1) + ". " + s); });
    }
    if (r.no) out.push("", r.no);
    if (r.src) out.push("", w.src + ": " + r.src);
    return out.join("\n");
  }
  // recipes.md: a heading per recipe, then its text (the text's first
  // line, the title, becomes the heading).
  function previews(state, lang, fmt) {
    var w = WORDS[lang === "el" ? "el" : "en"], out = {};
    var rc = (isObj(state) && Array.isArray(state.rc) ? state.rc : []).slice().sort(function (a, b) {
      return String(a.t).localeCompare(String(b.t));
    });
    if (rc.length) {
      var md = ["# " + w.title, ""];
      rc.forEach(function (r) {
        var text = "";
        try { text = fmt && typeof fmt.recipe === "function" ? String(fmt.recipe(r) || "") : ""; } catch (e) { text = ""; }
        if (!text) text = recipeTextOf(r, lang);
        var lines = text.split("\n");
        md.push("## " + lines[0]);
        md.push.apply(md, lines.slice(1));
        md.push("");
      });
      out["recipes.md"] = md.join("\n");
    }
    if (fmt && typeof fmt.shop === "function") {
      var shop = "";
      try { shop = String(fmt.shop() || ""); } catch (e) { shop = ""; }
      if (shop) out["shopping.txt"] = shop;
    }
    return out;
  }

  var DESC = {
    app: "meals", title: "Meal Planner", slice: "meals", ext: ".orosmeals", mime: "application/x-oros-meals",
    colls: {
      rc: { shape: "array", id: "id", stamp: "m" },
      pl: { shape: "map", stamp: "m" },
      ck: { shape: "map", stamp: "m" },
      mn: { shape: "array", id: "id", stamp: "m" },
      pa: { shape: "array", id: "id", stamp: "m" },
      pn: { shape: "map", stamp: "m" }
    },
    norm: function (data) { return norm(data); }, strip: strip, tombIds: tombIds,
    previews: function (state, lang) { return previews(state, lang, null); }
  };

  function copyDesc(over) {
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    Object.keys(over).forEach(function (k) { d[k] = over[k]; });
    return d;
  }
  // Only as many NEW records as fit under the app's own limits.
  function fit(list, local, key, max) {
    var have = {}, n = 0;
    (isObj(local) && Array.isArray(local[key]) ? local[key] : []).forEach(function (x) { if (x && x.id) { have[x.id] = 1; n++; } });
    var room = Math.max(0, max - n);
    return list.filter(function (x) {
      if (have[x.id]) return true;                  // the kit decides about these
      if (room <= 0) return false;
      room--;
      return true;
    });
  }
  function forLocal(getLocal, fmt) {
    return copyDesc({
      norm: function (data) {
        var out = norm(data);
        if (!out) return out;
        var local = typeof getLocal === "function" ? getLocal() : null;
        out.rc = fit(out.rc, local, "rc", C.LIM.recipes);
        out.pa = fit(out.pa, local, "pa", C.LIM.pantry);
        return out;
      },
      previews: function (state, lang) { return previews(state, lang, fmt || null); }
    });
  }
  function randomId() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function asCopy(getLocal, fmt, makeId) {
    var mk = typeof makeId === "function" ? makeId : randomId;
    return copyDesc({
      colls: { rc: DESC.colls.rc },
      norm: function (data) {
        var out = norm(data);
        if (!out) return out;
        var now = Date.now(), used = {}, local = typeof getLocal === "function" ? getLocal() : null;
        (isObj(local) && Array.isArray(local.rc) ? local.rc : []).forEach(function (r) { used[r.id] = 1; });
        if (isObj(local) && isObj(local.tombs)) Object.keys(local.tombs).forEach(function (id) { used[id] = 1; });
        var room = Math.max(0, C.LIM.recipes - ((isObj(local) && Array.isArray(local.rc)) ? local.rc.length : 0));
        var rc = [];
        out.rc.forEach(function (r) {
          if (rc.length >= room) return;
          var id = "", tries = 0;
          do { id = String(mk()); tries++; } while ((used[id] || !C.ID_RE.test(id)) && tries < 20);
          if (used[id] || !C.ID_RE.test(id)) return;
          used[id] = 1;
          var x = JSON.parse(JSON.stringify(r));
          x.id = id; x.m = now;
          rc.push(x);
        });
        return { ver: out.ver, rc: rc };            // the file's tombs do not apply to fresh ids
      },
      strip: function (state) { return { ver: C.DATA_VER, rc: isObj(state) && Array.isArray(state.rc) ? JSON.parse(JSON.stringify(state.rc)) : [] }; },
      tombIds: tombIds,
      previews: function (state, lang) { return previews(state, lang, fmt || null); }
    });
  }

  // Which collection each added key went to: compare before / after.
  function addedByColl(before, after, ids) {
    var want = {}, out = {};
    (ids || []).forEach(function (id) { want[String(id)] = 1; });
    COLLS.forEach(function (k) {
      out[k] = [];
      var had = {}, b = isObj(before) ? before[k] : null, a = isObj(after) ? after[k] : null;
      if (Array.isArray(a)) {
        (Array.isArray(b) ? b : []).forEach(function (x) { if (x) had[x.id] = 1; });
        a.forEach(function (x) { if (x && want[x.id] && !had[x.id]) out[k].push(x.id); });
      } else if (isObj(a)) {
        var bb = isObj(b) ? b : {};
        Object.keys(a).forEach(function (key) { if (want[key] && !Object.prototype.hasOwnProperty.call(bb, key)) out[k].push(key); });
      }
    });
    return out;
  }

  var api = { DESC: DESC, forLocal: forLocal, asCopy: asCopy, addedByColl: addedByColl, COLLS: COLLS,
              FUTURE_DAYS: FUTURE_DAYS, norm: norm, recipeTextOf: recipeTextOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosMealsPackage = api;
})(typeof window !== "undefined" ? window : this);
