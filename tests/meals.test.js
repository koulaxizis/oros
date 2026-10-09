// Pure logic of the Meal Planner (meals/core.js): quantities and units,
// the ingredient line parser, "paste a recipe", the shopping list, the
// diet checks, the ready recipes and the merge of the sync slice
// "meals" (R5, R17, R26).
// Run: node --test tests/
//
// core.js is evaluated as is in a fresh context (it attaches
// OrosMealsCore to its global).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "meals", "core.js"), "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const C = ctx.OrosMealsCore;
const j = (x) => JSON.parse(JSON.stringify(x));   // out of the vm realm

function rec(id, m, extra) {
  return Object.assign({ id, m, t: "Recipe " + id, sv: 4, ig: [], st: [] }, extra || {});
}
function data(extra) { return Object.assign(j(C.emptyData()), extra || {}); }
function canon(x) { return JSON.stringify(C.mergeMeals(x, x)); }

test("quantities: fractions, decimals with comma, ranges, Greek thousands", () => {
  assert.equal(C.parseQty("1 1/2"), 1.5);
  assert.equal(C.parseQty("1½"), 1.5);
  assert.equal(C.parseQty("½"), 0.5);
  assert.equal(C.parseQty("0,5"), 0.5);
  assert.equal(C.parseQty("2.25"), 2.25);
  assert.equal(C.parseQty("2-3"), 3);
  assert.equal(C.parseQty("2 – 3"), 3);
  assert.equal(C.parseQty("1.000"), 1000);
  assert.equal(C.parseQty("abc"), null);
  assert.equal(C.parseQty("0"), null);
  assert.equal(C.parseQty("1/0"), null);
  assert.equal(C.parseQty(""), null);
});

test("quantities: friendly formatting per language", () => {
  assert.equal(C.fmtQty(1.5, "en"), "1½");
  assert.equal(C.fmtQty(0.25, "el"), "¼");
  assert.equal(C.fmtQty(2 / 3, "en"), "⅔");
  assert.equal(C.fmtQty(3, "en"), "3");
  assert.equal(C.fmtQty(1.4, "el"), "1,4");
  assert.equal(C.fmtQty(1.4, "en"), "1.4");
  assert.equal(C.fmtQty(12.6, "en"), "13");
  assert.equal(C.fmtQty(333.33, "en", true), "335");      // grams: to 5 above 100
  assert.equal(C.fmtQty(2.99, "en"), "3");
});

test("ingredient lines: quantity, unit, name, note (EN and EL)", () => {
  const p = (s) => j(C.parseIngLine(s));
  assert.deepEqual(p("500 γρ. ξερά φασόλια, μουλιασμένα"), { q: 500, u: "g", n: "ξερά φασόλια", x: "μουλιασμένα", g: "" });
  assert.deepEqual(p("2 κ.σ. πελτές ντομάτας"), { q: 2, u: "tbsp", n: "πελτές ντομάτας", x: "", g: "" });
  assert.deepEqual(p("1 κουταλάκι του γλυκού κανέλα"), { q: 1, u: "tsp", n: "κανέλα", x: "", g: "" });
  assert.deepEqual(p("1,5 κιλό κοτόπουλο, σε μερίδες"), { q: 1.5, u: "kg", n: "κοτόπουλο", x: "σε μερίδες", g: "" });
  assert.deepEqual(p("200g feta"), { q: 200, u: "g", n: "feta", x: "", g: "" });
  assert.deepEqual(p("2 cups of flour"), { q: 2, u: "cup", n: "flour", x: "", g: "" });
  assert.deepEqual(p("μισό λεμόνι"), { q: 0.5, u: "", n: "λεμόνι", x: "", g: "" });
  assert.deepEqual(p("a pinch of salt"), { q: 1, u: "pinch", n: "salt", x: "", g: "" });
  assert.deepEqual(p("- 3 eggs (large)"), { q: 3, u: "", n: "eggs", x: "large", g: "" });
  assert.deepEqual(p("αλάτι"), { q: null, u: "", n: "αλάτι", x: "", g: "" });
  // "1 φέτα" is feta; "1 φέτα ψωμί" is a slice of bread.
  assert.deepEqual(p("1 φέτα"), { q: 1, u: "", n: "φέτα", x: "", g: "" });
  assert.deepEqual(p("1 φέτα ψωμί"), { q: 1, u: "slice", n: "ψωμί", x: "", g: "" });
  // "l" alone is no unit when nothing follows.
  assert.deepEqual(p("2 l"), { q: 2, u: "", n: "l", x: "", g: "" });
  assert.equal(C.parseIngLine("   "), null);
});

test("ingredient text: groups and round trip", () => {
  const text = "500 g flour\n2 eggs\n\nFor the sauce:\n200 ml milk\n1 tbsp butter";
  const ings = j(C.textToIngs(text));
  assert.equal(ings.length, 4);
  assert.equal(ings[2].g, "For the sauce");
  assert.equal(ings[0].g, "");
  assert.equal(C.ingsToText(ings, "en"), text);
  assert.deepEqual(j(C.textToIngs(C.ingsToText(ings, "en"))), ings);
});

test("steps: numbering stripped, empty lines dropped", () => {
  assert.deepEqual(j(C.textToSteps("1. Boil.\n\n2) Drain.\nStep 3: Serve.\nΒήμα 4: Τέλος")), ["Boil.", "Drain.", "Serve.", "Τέλος"]);
});

test("ingredient keys: singular and plural meet, accents and case ignored", () => {
  const k = C.keyOf;
  assert.equal(k("Ντομάτες"), k("ντομάτα"));
  assert.equal(k("κρεμμύδια"), k("Κρεμμύδι"));
  assert.equal(k("αυγά"), k("αυγό"));
  assert.equal(k("eggs"), k("egg"));
  assert.equal(k("Tomatoes"), k("tomato"));
  assert.equal(k("berries"), k("berry"));
  assert.notEqual(k("πιπεριά"), k("πιπέρι"));     // bell pepper ≠ pepper
  assert.notEqual(k("καρύδα"), k("καρύδια"));     // coconut ≠ walnuts
});

test("paste a recipe: title, servings, groups, steps (Greek)", () => {
  const d = j(C.parseRecipeText("Μουσακάς\nΜερίδες: 6\n\nΥλικά\n- 3 μελιτζάνες\n- 500 γρ. κιμάς\nΓια τη μπεσαμέλ:\n- 1 λίτρο γάλα\n\nΕκτέλεση\n1. Τηγανίζουμε.\n2. Ψήνουμε 1 ώρα.\n\nΣημειώσεις\nΤρώγεται και κρύος."));
  assert.equal(d.t, "Μουσακάς");
  assert.equal(d.sv, 6);
  assert.equal(d.ig.length, 3);
  assert.equal(d.ig[2].g, "Για τη μπεσαμέλ");
  assert.equal(d.ig[2].u, "l");
  assert.deepEqual(d.st, ["Τηγανίζουμε.", "Ψήνουμε 1 ώρα."]);
  assert.equal(d.no, "Τρώγεται και κρύος.");
});

test("paste a recipe: no headers (EN), times", () => {
  const d = j(C.parseRecipeText("Pancakes\nServes 2\nPrep time: 10 min\nCook time: 1 hour 5 min\n200 g flour\n2 eggs\n300 ml milk\nMix everything until smooth.\nFry in a hot pan."));
  assert.equal(d.t, "Pancakes");
  assert.equal(d.sv, 2);
  assert.equal(d.pt, 10);
  assert.equal(d.ct, 65);
  assert.equal(d.ig.length, 3);
  assert.equal(d.st.length, 2);
  assert.equal(j(C.parseRecipeText("")).t, "");
});

test("timers found in steps", () => {
  assert.deepEqual(j(C.stepTimers("Simmer for 60 minutes, then 1½ hours more")), [60, 90]);
  assert.deepEqual(j(C.stepTimers("Βράζουμε 25 λεπτά")), [25]);
  assert.deepEqual(j(C.stepTimers("Ψήνουμε μισή ώρα")), [30]);
  assert.deepEqual(j(C.stepTimers("Serve.")), []);
});

test("ready recipes: both languages, same shape, valid, no diet warnings", () => {
  assert.equal(C.SEED_IDS.length, 8);
  C.SEED_IDS.forEach((id) => {
    const en = j(C.seedRecipe(id, "en")), el = j(C.seedRecipe(id, "el"));
    assert.ok(en && el, id);
    assert.equal(en.m, 0);
    assert.equal(en.ig.length, el.ig.length, id);
    assert.equal(en.st.length, el.st.length, id);
    assert.deepEqual(en.dt, el.dt, id);
    en.ig.forEach((ing, i) => {
      assert.equal(ing.u, el.ig[i].u, id + " unit " + i);
      assert.equal(ing.q, el.ig[i].q, id + " qty " + i);
    });
    assert.deepEqual(j(C.dietWarnings(en)), [], id + " en");
    assert.deepEqual(j(C.dietWarnings(el)), [], id + " el");
    assert.deepEqual(j(C.normRecipe(en)), en, id);
    // The text in the source parses back to itself.
    assert.deepEqual(j(C.textToIngs(C.ingsToText(el.ig, "el"))), el.ig, id);
  });
});

test("ready recipes are not stored until changed, and a deleted one stays deleted", () => {
  const d = data();
  assert.equal(C.allRecipes(d, "en").length, 8);
  assert.equal(C.mergeMeals(d, d).rc.length, 0);
  const del = data({ tombs: { "s-fasolada": 5 } });
  assert.ok(!C.allRecipes(C.mergeMeals(del, del), "el").some((r) => r.id === "s-fasolada"));
  // a tomb of a ready recipe is never pruned, however old
  const late = data({ tombs: { "s-fasolada": 5 }, pl: { "2030-01-01|d": { m: 9, it: [{ t: "x" }] } } });
  assert.equal(C.mergeMeals(late, late).tombs["s-fasolada"], 5);
});

test("diets: warnings from ingredients, suggestions, fit", () => {
  const r = j(C.normRecipe(rec("abc1", 1, { dt: ["vegan", "gf", "fast"], ig: C.textToIngs("200 g feta\n2 αυγά\n100 g αλεύρι\n1 κ.σ. μέλι") })));
  const w = j(C.dietWarnings(r));
  assert.deepEqual(w.map((x) => x.d), ["vegan", "gf", "fast"]);
  assert.deepEqual(w[0].ings, ["feta", "αυγά", "μέλι"]);
  assert.deepEqual(w[1].ings, ["αλεύρι"]);
  // shellfish and octopus are fine for fasting, not for vegetarians
  const oct = j(C.normRecipe(rec("abc2", 1, { dt: ["fast", "veg"], ig: C.textToIngs("1 χταπόδι\n4 κ.σ. ελαιόλαδο") })));
  assert.deepEqual(j(C.dietWarnings(oct)).map((x) => x.d), ["veg"]);
  // plant milk is not dairy
  const pm = j(C.normRecipe(rec("abc3", 1, { dt: ["vegan", "lf"], ig: C.textToIngs("200 ml γάλα καρύδας\n100 ml soy milk") })));
  assert.deepEqual(j(C.dietWarnings(pm)), []);
  // raw: a cooking time breaks it
  const raw = j(C.normRecipe(rec("abc4", 1, { dt: ["raw"], ct: 10 })));
  assert.deepEqual(j(C.dietWarnings(raw)), [{ d: "raw", ings: ["*cooked"] }]);
  // keto: pasta and sugar
  const k = j(C.normRecipe(rec("abc5", 1, { dt: ["keto"], ig: C.textToIngs("500 g spaghetti\n1 tsp sugar\n2 eggs") })));
  assert.deepEqual(j(C.dietWarnings(k))[0].ings, ["spaghetti", "sugar"]);
  // suggestions never claim keto, low-carb or raw
  const s = j(C.suggestDiets(j(C.seedRecipe("s-horiatiki", "el"))));
  assert.deepEqual(s, ["veg", "pesc", "gf", "nut"]);
  assert.deepEqual(j(C.suggestDiets({ ig: [] })), []);
  assert.ok(C.fits({ dt: ["vegan", "gf"] }, ["vegan"]));
  assert.ok(!C.fits({ dt: ["veg"] }, ["vegan"]));
  assert.ok(C.fits({ dt: [] }, []));
});

test("aisles from the dictionary", () => {
  const a = (n) => C.lookup(n).aisle;
  assert.equal(a("Ντομάτες"), "produce");
  assert.equal(a("πελτές ντομάτας"), "pantry");
  assert.equal(a("tomato paste"), "pantry");
  assert.equal(a("κιμάς μοσχαρίσιος"), "meat");
  assert.equal(a("green peppers"), "produce");
  assert.equal(a("pepper"), "spices");
  assert.equal(a("φύλλα δάφνης"), "spices");
  assert.equal(a("something odd"), "other");
});

test("normalize: limits, junk dropped, idempotent", () => {
  assert.equal(C.normRecipe(rec("ab", 1)), null);            // id too short
  assert.equal(C.normRecipe(rec("abc", -1)), null);
  assert.equal(C.normRecipe(rec("abc", 1, { t: "  " })), null);
  const x = j(C.normRecipe(rec("abc", 1, {
    t: "x".repeat(200), sv: 999, pt: -5, ct: "12", dt: ["vegan", "bogus", "vegan"], c: "nope",
    tg: ["a", "A", " b ", "", 5], ig: [{ q: -1, u: "zz", n: " flour " }, { n: "" }, null], st: ["", " go ", 7], fv: 2
  })));
  assert.equal(x.t.length, C.LIM.title);
  assert.equal(x.sv, C.LIM.servings);
  assert.equal(x.pt, 0);
  assert.equal(x.ct, 12);
  assert.deepEqual(x.dt, ["vegan"]);
  assert.equal(x.c, "");
  assert.deepEqual(x.tg, ["a", "b"]);
  assert.deepEqual(x.ig, [{ q: null, u: "", n: "flour", x: "", g: "" }]);
  assert.deepEqual(x.st, ["go"]);
  assert.equal(x.fv, 0);
  assert.deepEqual(j(C.normRecipe(x)), x);
  assert.deepEqual(Object.keys(x), ["id", "m", "t", "e", "c", "sv", "pt", "ct", "dt", "tg", "ig", "st", "no", "src", "fv"]);
});

test("merge: recipes LWW, equal stamp → larger JSON, symmetric", () => {
  const a = data({ rc: [rec("aaa", 5, { t: "A" })] });
  const b = data({ rc: [rec("aaa", 7, { t: "B" })] });
  assert.equal(C.mergeMeals(a, b).rc[0].t, "B");
  assert.equal(canon(C.mergeMeals(a, b)), canon(C.mergeMeals(b, a)));
  const c = data({ rc: [rec("aaa", 5, { t: "Z" })] });
  assert.equal(C.mergeMeals(a, c).rc[0].t, "Z");
  assert.equal(C.mergeMeals(c, a).rc[0].t, "Z");
});

test("merge: tombstones win ties, a newer edit resurrects (R17)", () => {
  const live = data({ rc: [rec("aaa", 5)] });
  const tomb5 = data({ tombs: { aaa: 5 } });
  assert.equal(C.mergeMeals(live, tomb5).rc.length, 0);
  assert.equal(C.mergeMeals(tomb5, live).rc.length, 0);
  const edit = data({ rc: [rec("aaa", 6)] });
  assert.equal(C.mergeMeals(edit, tomb5).rc.length, 1);
  assert.equal(C.mergeMeals(edit, tomb5).tombs.aaa, 5);
});

test("merge: plan cells and ticks per key, a clear is a newer write", () => {
  const a = data({ pl: { "2026-10-05|d": { m: 5, it: [{ r: "s-fasolada", sv: 4 }] } }, ck: { "2026-10-05|ντοματ": { v: 1, m: 3 } } });
  const b = data({ pl: { "2026-10-05|d": { m: 6, it: [] }, "2026-10-06|l": { m: 2, it: [{ t: "Out" }] } }, ck: { "2026-10-05|ντοματ": { v: 0, m: 4 } } });
  const m = j(C.mergeMeals(a, b));
  assert.deepEqual(m.pl["2026-10-05|d"], { m: 6, it: [] });
  assert.deepEqual(m.pl["2026-10-06|l"], { m: 2, it: [{ t: "Out" }] });
  assert.deepEqual(m.ck["2026-10-05|ντοματ"], { v: 0, m: 4 });
  // junk keys and cells go
  const junk = data({ pl: { "2026-02-30|d": { m: 1, it: [] }, "2026-10-05|q": { m: 1, it: [] }, "x": {} }, ck: { "nope": { v: 1, m: 1 } } });
  assert.deepEqual(j(C.mergeMeals(junk, junk)).pl, {});
  assert.deepEqual(j(C.mergeMeals(junk, junk)).ck, {});
});

test("merge: manual items need their week in the id; tombs drop them", () => {
  const ok = { id: "n20261005-abcd1", m: 3, w: "2026-10-05", t: "Paper", d: 0 };
  const bad = { id: "n20261006-abcd1", m: 3, w: "2026-10-05", t: "Paper", d: 0 };
  assert.equal(C.mergeMeals(data({ mn: [ok, bad] }), data()).mn.length, 1);
  assert.equal(C.mergeMeals(data({ mn: [ok] }), data({ tombs: { "n20261005-abcd1": 3 } })).mn.length, 0);
});

test("merge: old days pruned by the newest day in the data, same in any order", () => {
  const oldCell = { "2025-01-01|d": { m: 1, it: [{ t: "old" }] } };
  const newCell = { "2026-10-05|d": { m: 2, it: [{ t: "new" }] } };
  const a = data({ pl: oldCell, mn: [{ id: "n20250101-zzzz", m: 1, w: "2025-01-01", t: "x", d: 0 }] });
  const b = data({ pl: newCell });
  const m = j(C.mergeMeals(a, b));
  assert.deepEqual(Object.keys(m.pl), ["2026-10-05|d"]);
  assert.equal(m.mn.length, 0);
  // alone, the old week stays (nothing newer to measure against)
  assert.deepEqual(Object.keys(j(C.mergeMeals(a, a)).pl), ["2025-01-01|d"]);
  assert.equal(canon(C.mergeMeals(C.mergeMeals(a, b), a)), canon(C.mergeMeals(a, C.mergeMeals(b, a))));
});

test("merge: settings LWW as a whole, defaults when absent", () => {
  const a = data({ set: { m: 3, dt: ["vegan"], sl: ["d", "l"], nm: { d: "Supper" }, ws: 0 } });
  const b = data({ set: { m: 2, dt: ["keto"], sl: ["b"], nm: {}, ws: 1 } });
  const s = j(C.mergeMeals(a, b).set);
  assert.deepEqual(s, { m: 3, dt: ["vegan"], sl: ["d", "l"], nm: { d: "Supper" }, ws: 0 });
  assert.deepEqual(j(C.mergeMeals({}, {}).set), j(C.defaultSet()));
  assert.deepEqual(j(C.normSet({ m: 1, sl: [] })).sl, ["b", "l", "d"]);
});

test("merge: never throws on garbage, never returns undefined parts", () => {
  [null, undefined, 5, "x", [], { rc: "x", pl: 5, ck: [], mn: {}, tombs: [] }].forEach((g) => {
    const m = j(C.mergeMeals(g, g));
    assert.deepEqual(Object.keys(m), ["ver", "rc", "pl", "ck", "mn", "ai", "pn", "set", "tombs"]);
  });
});

// Random states for the merge laws.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function randState(r) {
  const ids = ["aaa", "bbb", "ccc", "s-fasolada"];
  const days = ["2026-10-05", "2026-10-06", "2025-08-01", "2024-01-01"];
  const d = data();
  ids.forEach((id) => { if (r() < 0.6) d.rc.push(rec(id, Math.floor(r() * 5), { t: "T" + Math.floor(r() * 3), fv: r() < 0.5 ? 1 : 0 })); });
  ids.forEach((id) => { if (r() < 0.3) d.tombs[id] = Math.floor(r() * 5); });
  days.forEach((day) => {
    ["b", "d"].forEach((s) => { if (r() < 0.5) d.pl[day + "|" + s] = { m: Math.floor(r() * 5), it: r() < 0.3 ? [] : [{ r: ids[Math.floor(r() * 4)], sv: 1 + Math.floor(r() * 4) }] }; });
    if (r() < 0.4) d.ck[day + "|ντοματ"] = { v: r() < 0.5 ? 1 : 0, m: Math.floor(r() * 5) };
    if (r() < 0.3) d.mn.push({ id: "n" + day.replace(/-/g, "") + "-k" + Math.floor(r() * 2) + "aa", m: Math.floor(r() * 5), w: day, t: "M" + Math.floor(r() * 3), d: r() < 0.5 ? 1 : 0 });
  });
  if (r() < 0.5) d.pn["ντοματ"] = { v: r() < 0.5 ? 1 : 0, m: Math.floor(r() * 5) };
  if (r() < 0.5) d.ai["ντοματ"] = { a: "pantry", m: Math.floor(r() * 5) };
  if (r() < 0.5) d.set = { m: Math.floor(r() * 5), dt: r() < 0.5 ? ["vegan"] : [], sl: ["b", "d"], nm: {}, ws: r() < 0.5 ? 1 : 0 };
  return d;
}

test("merge laws (fuzz): commutative, associative, idempotent, canonical", () => {
  const r = rng(42);
  for (let i = 0; i < 400; i++) {
    const a = randState(r), b = randState(r), c = randState(r);
    const ab = C.mergeMeals(a, b), ba = C.mergeMeals(b, a);
    assert.equal(JSON.stringify(ab), JSON.stringify(ba), "commutative " + i);
    assert.equal(JSON.stringify(C.mergeMeals(ab, ab)), JSON.stringify(ab), "idempotent " + i);
    assert.equal(JSON.stringify(C.mergeMeals(C.mergeMeals(a, b), c)), JSON.stringify(C.mergeMeals(a, C.mergeMeals(b, c))), "associative " + i);
    assert.equal(JSON.stringify(C.mergeMeals(ab, a)), JSON.stringify(ab), "absorbs " + i);
  }
});

test("shopping: scaled, added up across recipes and units, pantry left out", () => {
  const r1 = rec("aaa", 1, { t: "Soup", sv: 2, ig: j(C.textToIngs("200 g ντομάτες\n1 tbsp oil\nαλάτι\n2 κρεμμύδια")) });
  const r2 = rec("bbb", 1, { t: "Salad", sv: 4, ig: j(C.textToIngs("1 κιλό ντομάτα\n2 tsp oil\n1 κρεμμύδι, ψιλοκομμένο")) });
  const d = C.mergeMeals(data({
    rc: [r1, r2],
    pl: {
      "2026-10-05|d": { m: 1, it: [{ r: "aaa", sv: 4 }] },        // ×2
      "2026-10-07|l": { m: 1, it: [{ r: "bbb", sv: 4 }, { t: "Out" }] },
      "2026-10-12|l": { m: 1, it: [{ r: "bbb", sv: 4 }] }         // next week: not counted
    },
    ck: { "2026-10-05|κρεμμυδ": { v: 1, m: 1 } },
    mn: [{ id: "n20261005-abcd", m: 1, w: "2026-10-05", t: "Χαρτί κουζίνας", d: 0 }]
  }), data());
  const get = (id) => C.mergeMeals(d, d).rc.find((x) => x.id === id) || null;
  const L = j(C.buildShop(C.mergeMeals(d, d), get, "2026-10-05", null, "el"));
  const by = {};
  L.items.forEach((i) => { by[i.name] = i; });
  assert.equal(by["ντομάτες"].qty, "1,4 κιλά");                 // 400 g + 1 kg
  assert.equal(by["oil"].qty, "2⅔ κ.σ.");                        // 2 × 1 tbsp + 2 tsp = 8 tsp
  assert.equal(by["κρεμμύδια"].qty, "5");                        // 2×2 + 1
  assert.equal(by["κρεμμύδια"].done, true);
  assert.deepEqual(by["κρεμμύδια"].from, ["Soup", "Salad"]);
  assert.ok(!by["αλάτι"]);
  assert.deepEqual(L.excluded.map((x) => x.name), ["αλάτι"]);
  assert.equal(by["Χαρτί κουζίνας"].manual, true);
  assert.equal(L.items[0].aisle, "produce");
  // "from today": earlier days of the week drop out
  const L2 = j(C.buildShop(C.mergeMeals(d, d), get, "2026-10-05", "2026-10-06", "el"));
  assert.equal(L2.items.find((i) => i.name === "oil").qty, "2 κ.γ.");
  assert.equal(L2.items.find((i) => i.key === C.keyOf("ντομάτα")).qty, "1 κιλό");
  // the pantry can be overridden both ways
  const d2 = C.mergeMeals(d, data({ pn: { [C.keyOf("αλάτι")]: { v: 0, m: 2 }, [C.keyOf("κρεμμύδι")]: { v: 1, m: 2 } } }));
  const L3 = j(C.buildShop(d2, get, "2026-10-05", null, "el"));
  assert.ok(L3.items.some((i) => i.name === "αλάτι"));
  assert.ok(!C.inPantry(d2, C.keyOf("salt")));                  // a ready pair flips as one
  assert.ok(!L3.items.some((i) => i.name === "κρεμμύδια"));
  // settings list: one entry per ready pair in the language, own items by name
  const d3 = C.mergeMeals(d2, data({ pn: { [C.keyOf("ελαιόλαδο")]: { v: 1, m: 3, n: "Ελαιόλαδο" } } }));
  assert.deepEqual(j(C.pantryList(d3, "el")).map((p) => p.name), ["πιπέρι", "νερό", "Ελαιόλαδο", "κρεμμυδ"]);
  assert.deepEqual(j(C.pantryList(d3, "en")).map((p) => p.name).slice(0, 2), ["pepper", "water"]);
  assert.ok(j(C.pantryList(d3, "el")).some((p) => p.name === "Ελαιόλαδο"));
  assert.ok(!j(C.pantryList(d3, "el")).some((p) => p.name === "αλάτι"));
  // as text, by aisle
  const txt = C.shopText(C.buildShop(C.mergeMeals(d, d), get, "2026-10-05", null, "en"), (a) => a.toUpperCase(), "en");
  assert.match(txt, /^PRODUCE:\n/);
  assert.match(txt, /☑ 5 κρεμμύδια/);
});

test("dates: week start Monday or Sunday, days, validity", () => {
  assert.equal(C.weekStartOf("2026-10-08", 1), "2026-10-05");
  assert.equal(C.weekStartOf("2026-10-05", 1), "2026-10-05");
  assert.equal(C.weekStartOf("2026-10-11", 1), "2026-10-05");
  assert.equal(C.weekStartOf("2026-10-08", 0), "2026-10-04");
  assert.equal(C.weekDays("2026-10-26").length, 7);
  assert.equal(C.weekDays("2026-10-26")[6], "2026-11-01");    // across the DST change
  assert.ok(C.validYmd("2028-02-29"));
  assert.ok(!C.validYmd("2026-02-29"));
});
