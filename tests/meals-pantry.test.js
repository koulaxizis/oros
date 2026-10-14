// Meal Planner wave 3: the pantry and nutrition in the sync slice
// (meals/core.js), the nutrition estimate and Open Food Facts readers
// (meals/nutrition.js) and the pantry rules (meals/pantry.js): matching,
// amounts in other units, "enough for the shopping line", what can I
// cook, what "Cooked" takes, best-before days and the shell's notice.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = {};
vm.createContext(ctx);
for (const f of ["core.js", "nutrition.js", "pantry.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "meals", f), "utf8"), ctx);
}
const C = ctx.OrosMealsCore, N = ctx.OrosMealsNutrition, P = ctx.OrosMealsPantry;
const j = (x) => JSON.parse(JSON.stringify(x));
const item = (id, m, n, q, u, extra) => Object.assign({ id, m, n, q, u, l: "cupboard", bb: "", bc: "" }, extra || {});
const merge = (a, b) => j(C.mergeMeals(a, b));
const base = (extra) => Object.assign(j(C.emptyData()), extra || {});

// ---------- Slice ----------
test("pantry items: normalised, bad ones dropped, keys always present", () => {
  const d = merge(base({ pa: [
    { id: "pa-abcd1", m: 5, n: "  Milk ", q: 1, u: "l", l: "fridge", bb: "2026-10-20", bc: "5201054017234" },
    { id: "pa-abcd2", m: 5, n: "Salt" },                        // no amount: q null, u ""
    { id: "pa-abcd3", m: 5, n: "x", q: 2, u: "parsec", l: "attic", bb: "2026-02-30", bc: "12ab" },
    { id: "bad id", m: 5, n: "y" }, { id: "pa-abcd4", m: 5, n: "" }, { id: "pa-abcd5", m: -1, n: "z" }
  ] }), {});
  assert.deepEqual(d.pa, [
    { id: "pa-abcd1", m: 5, n: "Milk", q: 1, u: "l", l: "fridge", bb: "2026-10-20", bc: "5201054017234" },
    { id: "pa-abcd2", m: 5, n: "Salt", q: null, u: "", l: "cupboard", bb: "", bc: "" },
    { id: "pa-abcd3", m: 5, n: "x", q: 2, u: "", l: "cupboard", bb: "", bc: "" }
  ]);
});

test("pantry merge: LWW per item, tombs win at or after m, order-free", () => {
  const a = base({ pa: [item("pa-aaaa1", 10, "eggs", 6, "pc"), item("pa-aaaa2", 10, "feta", 200, "g")] });
  const b = base({ pa: [item("pa-aaaa1", 12, "eggs", 3, "pc")], tombs: { "pa-aaaa2": 10 } });
  const ab = merge(a, b), ba = merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab.pa.map((x) => [x.id, x.q]), [["pa-aaaa1", 3]]);
  assert.equal(ab.tombs["pa-aaaa2"], 10);
  // a newer edit after the tomb comes back (R17)
  const c = merge(ab, base({ pa: [item("pa-aaaa2", 11, "feta", 100, "g")] }));
  assert.deepEqual(c.pa.map((x) => x.id), ["pa-aaaa1", "pa-aaaa2"]);
  // canonical: merging with itself changes nothing
  assert.deepEqual(merge(c, c), c);
});

test("pantry tombs older than 180 days before the newest pantry stamp go; others stay", () => {
  const day = 86400000, now = 400 * day;
  const d = merge(base({ pa: [item("pa-live1", now, "rice", 1, "kg")],
    tombs: { "pa-old01": now - 181 * day, "pa-new01": now - 10 * day, "r-recipe1": 1 } }), {});
  assert.deepEqual(Object.keys(d.tombs).sort(), ["pa-new01", "r-recipe1"]);
});

test("old data without pa / nu loads; the new keys are added empty", () => {
  const old = { ver: 1, rc: [], pl: {}, ck: {}, mn: [], ai: {}, pn: {}, set: { m: 0, dt: [], sl: ["b", "l", "d"], nm: {}, ws: 1 }, tombs: {} };
  const d = merge(old, old);
  assert.deepEqual(d.pa, []);
  assert.deepEqual(d.nu, {});
});

test("ticks and manual items keep 'put in the pantry' (p: 1) only when set", () => {
  const d = merge(base({
    ck: { "2026-10-12|egg": { v: 1, m: 3, p: 1 }, "2026-10-12|milk": { v: 1, m: 3, p: 7 } },
    mn: [{ id: "n20261012-abcd", m: 2, w: "2026-10-12", t: "bread", d: 1, p: 1 }, { id: "n20261012-abce", m: 2, w: "2026-10-12", t: "jam", d: 0 }]
  }), {});
  assert.deepEqual(d.ck["2026-10-12|egg"], { v: 1, m: 3, p: 1 });
  assert.deepEqual(d.ck["2026-10-12|milk"], { v: 1, m: 3 });
  assert.equal(d.mn[0].p, 1);
  assert.equal("p" in d.mn[1], false);
});

test("nutrition matches: normalised, LWW per key, junk dropped", () => {
  const d = merge(base({ nu: {
    egg: { m: 2, s: "tbl", t: "egg", g: 55 },
    feta: { m: 3, s: "off", c: "5201054017234", nm: "Feta PDO", k: 270, p: 16, cb: 0.5, f: 22, junk: 1 },
    salt: { m: 1, s: "x", g: 4 },
    bad1: { m: 1, s: "off", k: 5000, p: 1, cb: 1, f: 1 }, bad2: { m: 1, s: "tbl", t: "NO SPACES" }, bad3: { m: 1, s: "?" }
  } }), base({ nu: { egg: { m: 5, s: "x" } } }));
  assert.deepEqual(d.nu, {
    egg: { m: 5, s: "x" },
    feta: { m: 3, s: "off", c: "5201054017234", nm: "Feta PDO", k: 270, p: 16, cb: 0.5, f: 22 },
    salt: { m: 1, s: "x" }
  });
});

// ---------- Nutrition ----------
test("built-in table: about 150+ rows, names in EN and EL find the right row", () => {
  assert.ok(N.ROWS_COUNT >= 150);
  const cases = { "dried white beans": "beans", "ξερά φασόλια": "beans", "tomato paste": "tomato-paste", "πελτές ντομάτας": "tomato-paste",
    "πράσινες πιπεριές": "green-pepper", "πιπέρι": "black-pepper", "green peppers": "green-pepper", "κιμάς μοσχαρίσιος": "beef-mince",
    "Greek yogurt": "greek-yogurt", "στραγγιστό γιαούρτι": "greek-yogurt", "olive oil": "olive-oil", "oil": "oil", "γάλα καρύδας": "coconut-milk",
    "milk": "milk", "τριμμένο κεφαλοτύρι": "kefalotyri", "chicken stock": "stock", "chicken breast": "chicken-breast", "spaghetti": "pasta" };
  for (const [name, id] of Object.entries(cases)) assert.equal((N.findBuiltIn(name) || {}).id, id, name);
  assert.equal(N.findBuiltIn("unobtainium"), null);
});

test("unit → grams: mass exact, volume and spoons by density, pieces by piece weight", () => {
  const egg = N.rowById("egg"), oil = N.rowById("olive-oil"), flour = N.rowById("flour");
  assert.equal(N.grams(2, "kg", null), 2000);
  assert.ok(Math.abs(N.grams(1, "lb", null) - 453.592) < 1e-6);
  assert.ok(Math.abs(N.grams(100, "ml", oil) - 92) < 1e-6);
  assert.ok(Math.abs(N.grams(1, "cup", flour) - 240 * 0.53) < 1e-6);
  assert.equal(N.grams(2, "tbsp", null), 30);
  assert.equal(N.grams(3, "pc", egg), 150);
  assert.equal(N.grams(3, "", egg), 150);
  assert.equal(N.grams(2, "pc", null), null);           // no piece weight known
  assert.equal(N.grams(2, "pc", null, 80), 160);        // the user's own
  assert.equal(N.grams(1, "can", null), 400);
  assert.equal(N.grams(1, "pack", null), null);
  assert.equal(N.grams(null, "g", null), null);
});

test("recipe estimate: per serving from the seeds, counted vs missing, user matches win", () => {
  const om = C.seedRecipe("s-omelette", "en");
  const e = N.recipeNutrition(om, {});
  // 3 eggs 150 g + 2 tbsp milk 30.9 g + 1 tbsp butter 14.4 g + 30 g cheese
  const want = 1.43 * 150 + 0.61 * 30.9 + 7.17 * 14.4 + 4.03 * 30;
  assert.ok(Math.abs(e.per.k - want) < 0.5, e.per.k + " vs " + want);
  assert.equal(e.counted, 4);
  assert.equal(e.missing, 0);
  assert.deepEqual(j(e.rows.filter((r) => r.st === "noqty").map((r) => r.ing.n)), ["salt", "pepper"]);
  // per serving does not depend on the servings shown
  const two = Object.assign(j(om), { sv: 2, ig: om.ig.map((i) => Object.assign({}, i, { q: i.q === null ? null : i.q * 2 })) });
  assert.ok(Math.abs(N.recipeNutrition(two, {}).per.k - e.per.k) < 1e-6);
  // leave cheese out; eggs from "Open Food Facts" with the table's piece weight
  const nu = { "grated cheese": { m: 1, s: "x" }, egg: { m: 1, s: "off", k: 100, p: 10, cb: 1, f: 6, nm: "Eggs" } };
  const e2 = N.recipeNutrition(om, nu);
  assert.equal(e2.rows.find((r) => r.ing.n === "grated cheese").st, "x");
  assert.equal(e2.rows[0].src, "off");
  assert.equal(e2.rows[0].g, 150);
  // unknown ingredient → nomatch; a piece without weight → nogram
  const odd = { id: "r-odd1", m: 1, t: "odd", sv: 1, ig: [{ q: 1, u: "", n: "unobtainium" }, { q: 1, u: "pack", n: "pasta" }] };
  assert.deepEqual(j(N.recipeNutrition(odd, {}).rows.map((r) => r.st)), ["nomatch", "nogram"]);
  assert.equal(N.recipeNutrition(odd, {}).any, false);
});

test("a day of the plan: one serving of each planned recipe, cached by id@m", () => {
  const om = C.seedRecipe("s-omelette", "en"), fa = C.seedRecipe("s-fasolada", "en");
  const get = (id) => ({ "s-omelette": om, "s-fasolada": fa })[id] || null;
  const cache = {};
  const d = N.dayNutrition([{ it: [{ r: "s-omelette", sv: 1 }] }, { it: [{ r: "s-fasolada", sv: 6 }, { t: "Leftovers" }, { r: "gone-1", sv: 1 }] }], get, {}, cache);
  const k = N.recipeNutrition(om, {}).per.k + N.recipeNutrition(fa, {}).per.k;
  assert.ok(Math.abs(d.sum.k - k) < 1e-6);
  assert.equal(d.n, 2);
  assert.deepEqual(Object.keys(cache).sort(), ["s-fasolada@0", "s-omelette@0"]);
});

test("Open Food Facts: product and search answers read safely; kJ only → kcal", () => {
  const p = N.parseOffProduct({ status: 1, product: { code: "5201054017234", product_name: "Feta <b>PDO</b>", product_name_el: "Φέτα ΠΟΠ", brands: "Dodoni, Other",
    quantity: "400 g", nutriments: { "energy-kcal_100g": 270, proteins_100g: "16", carbohydrates_100g: 0.5, fat_100g: 22 } } }, "el");
  assert.deepEqual(j(p), { code: "5201054017234", name: "Φέτα ΠΟΠ", brand: "Dodoni", qty: "400 g", v: { k: 270, p: 16, cb: 0.5, f: 22 } });
  assert.equal(N.parseOffProduct({ status: 0, status_verbose: "product not found" }), null);
  assert.equal(N.parseOffProduct(null), null);
  const kj = N.parseOffProduct({ product: { code: "12345678", product_name: "X", nutriments: { "energy-kj_100g": 418.4, proteins_100g: 1, carbohydrates_100g: 2, fat_100g: 3 } } }, "en");
  assert.equal(kj.v.k, 100);
  const list = N.parseOffSearch({ products: [{ code: "1", product_name: "No values" }, { code: "3017620422003", product_name: "Spaghetti", nutriments: { "energy-kcal_100g": 359, proteins_100g: 12.5, carbohydrates_100g: 71.2, fat_100g: 2 } }, "junk"] }, "en");
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Spaghetti");
  assert.match(N.offSearchUrl("feta & olives", "el"), /^https:\/\/world\.openfoodfacts\.org\/cgi\/search\.pl\?search_terms=feta%20%26%20olives&.*lc=el/);
  assert.match(N.offProductUrl("5201054017234"), /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/5201054017234\.json/);
});

test("package quantities and barcode check digits", () => {
  assert.deepEqual(j(N.parseQuantity("400 g")), { q: 400, u: "g" });
  assert.deepEqual(j(N.parseQuantity("1,5 l")), { q: 1.5, u: "l" });
  assert.deepEqual(j(N.parseQuantity("6 x 125 g")), { q: 750, u: "g" });
  assert.deepEqual(j(N.parseQuantity("500ml")), { q: 500, u: "ml" });
  assert.deepEqual(j(N.parseQuantity("33 cl")), { q: 330, u: "ml" });
  assert.deepEqual(j(N.parseQuantity("6")), { q: 6, u: "pc" });
  assert.equal(N.parseQuantity("a lot"), null);
  assert.equal(N.validBarcode("5201054017234"), true);     // EAN-13
  assert.equal(N.validBarcode("5201054017235"), false);
  assert.equal(N.validBarcode("96385074"), true);           // EAN-8
  assert.equal(N.validBarcode("036000291452"), true);       // UPC-A
  assert.equal(N.validBarcode("1234"), false);
});

// ---------- Pantry rules ----------
test("matching: same key, words inside, but not across table rows", () => {
  const items = [item("pa-feta1", 1, "Feta Dodoni", 400, "g"), item("pa-milk1", 1, "milk", 1, "l"), item("pa-pep01", 1, "pepper", 50, "g"), item("pa-egg01", 1, "Eggs", 6, "pc")];
  assert.deepEqual(j(P.matches(items, "feta").map((x) => x.id)), ["pa-feta1"]);
  assert.deepEqual(j(P.matches(items, "egg").map((x) => x.id)), ["pa-egg01"]);
  assert.deepEqual(j(P.matches(items, "coconut milk").map((x) => x.id)), []);
  assert.deepEqual(j(P.matches(items, "green pepper").map((x) => x.id)), []);
  assert.deepEqual(j(P.matches(items, "black pepper").map((x) => x.id)), ["pa-pep01"]);
});

test("amounts convert within a family and through density / piece weight", () => {
  assert.equal(P.convert(1, "kg", "g", null), 1000);
  assert.equal(P.convert(2, "tbsp", "ml", null), 30);
  assert.equal(P.convert(500, "ml", "l", null), 0.5);
  assert.equal(P.convert(3, "pc", "pc", null), 3);
  const egg = N.rowById("egg");
  assert.equal(P.convert(100, "g", "pc", egg), 2);
  assert.equal(P.convert(1, "pack", "g", null), null);
  assert.deepEqual(j(P.niceAmount(0.97, "l")), { q: 970, u: "ml" });
  assert.deepEqual(j(P.niceAmount(1.5, "kg")), { q: 1.5, u: "kg" });
});

test("shopping line vs pantry: full, part, none; no amount counts as there", () => {
  const items = [item("pa-spag1", 1, "spaghetti", 800, "g"), item("pa-oil01", 1, "olive oil", null, ""), item("pa-egg01", 1, "eggs", 2, "pc")];
  const line = (name, am) => ({ name, manual: false, am });
  const am = (o) => Object.assign({ mass: 0, vol: 0, spoon: 0, u: {} }, o);
  assert.equal(P.coverShop(items, line("spaghetti", am({ mass: 500 }))).st, "full");
  assert.equal(P.coverShop(items, line("spaghetti", am({ mass: 1000 }))).st, "part");
  assert.equal(P.coverShop(items, line("olive oil", am({ spoon: 6 }))).st, "full");
  assert.equal(P.coverShop(items, line("eggs", am({ u: { pc: 3 } }))).st, "part");
  assert.equal(P.coverShop(items, line("eggs", am({ u: { pc: 2 } }))).st, "full");
  assert.equal(P.coverShop(items, line("eggs", am({ mass: 100 }))).st, "full");      // 2 × 50 g
  assert.equal(P.coverShop(items, line("carrots", am({ u: { pc: 2 } }))).st, "none");
  assert.equal(P.coverShop(items, { name: "eggs", manual: true, am: null }).st, "none");
  assert.equal(P.haveText([items[0], items[1]], "en"), "800 g + some");
});

test("a shopping line as a pantry draft", () => {
  const am = (o) => Object.assign({ mass: 0, vol: 0, spoon: 0, u: {} }, o);
  assert.deepEqual(j(P.fromShop({ name: "flour", am: am({ mass: 1500 }) })), { n: "flour", q: 1.5, u: "kg" });
  assert.deepEqual(j(P.fromShop({ name: "milk", am: am({ vol: 250 }) })), { n: "milk", q: 250, u: "ml" });
  assert.deepEqual(j(P.fromShop({ name: "eggs", am: am({ u: { pc: 6 } }) })), { n: "eggs", q: 6, u: "pc" });
  assert.deepEqual(j(P.fromShop({ name: "mix", am: am({ mass: 100, u: { pc: 1 } }) })), { n: "mix", q: null, u: "" });
  assert.equal(P.addInto(item("pa-x0001", 1, "rice", 1, "kg"), 500, "g"), 1.5);
  assert.equal(P.addInto(item("pa-x0001", 1, "rice", null, ""), 500, "g"), null);
  assert.equal(P.guessLoc("frozen peas"), "freezer");
  assert.equal(P.guessLoc("γιαούρτι"), "fridge");
  assert.equal(P.guessLoc("rice"), "cupboard");
});

test("what can I cook: fewest missing first, staples count, recipes with nothing at home left out", () => {
  const om = C.seedRecipe("s-omelette", "en"), fa = C.seedRecipe("s-fasolada", "en"), yo = C.seedRecipe("s-yogurt-honey", "en");
  const items = [item("pa-egg01", 1, "eggs", 6, "pc", { bb: "2026-10-15" }), item("pa-milk1", 1, "milk", 1, "l"), item("pa-butt1", 1, "butter", 250, "g"),
    item("pa-chee1", 1, "grated cheese", 10, "g")];
  const staple = (k) => k === "salt" || k === "pepper";
  const out = P.cookable([fa, om, yo], items, staple, "2026-10-14");
  assert.deepEqual(j(out.map((e) => e.r.id)), ["s-omelette"]);
  const e = out[0];
  assert.equal(e.total, 6);
  assert.equal(e.have, 6);
  assert.deepEqual(j(e.missing), []);
  assert.deepEqual(j(e.low.map((i) => i.n)), ["grated cheese"]);
  assert.equal(e.soon, 1);
});

test("cooked: takes soonest best-before first, across units; no amount → 'some'", () => {
  const om = C.seedRecipe("s-omelette", "en");
  const items = [item("pa-egg01", 1, "eggs", 2, "pc", { bb: "2026-10-15" }), item("pa-egg02", 1, "eggs", 6, "pc", { bb: "2026-10-30" }),
    item("pa-milk1", 1, "milk", 1, "l"), item("pa-salt1", 1, "salt", null, "")];
  const plan = P.cookPlan(om, 2, items, "2026-10-14");          // 2 servings: 6 eggs, 4 tbsp milk
  const by = Object.fromEntries(plan.map((p) => [p.ing.n, p]));
  assert.equal(by.eggs.st, "take");
  assert.deepEqual(j(by.eggs.takes), [{ id: "pa-egg01", take: 2, left: 0 }, { id: "pa-egg02", take: 4, left: 2 }]);
  assert.equal(by.eggs.short, 0);
  assert.deepEqual(j(by.milk.takes), [{ id: "pa-milk1", take: 0.06, left: 0.94 }]);
  assert.equal(by.salt.st, "some");
  assert.equal(by.butter.st, "none");
  // not enough: short in the recipe's unit
  const few = P.cookPlan(om, 1, [item("pa-egg01", 1, "eggs", 1, "pc")], "2026-10-14");
  assert.equal(few[0].short, 2);
});

test("best-before days, the reminder hour and the shell's notice from the raw blob", () => {
  assert.equal(P.daysLeft("2026-10-15", "2026-10-14"), 1);
  assert.equal(P.daysLeft("2026-10-13", "2026-10-14"), -1);
  assert.equal(P.daysLeft("", "2026-10-14"), null);
  assert.equal(P.notifyHour({ nt: 9 }), 9);
  assert.equal(P.notifyHour({ nt: 24 }), -1);
  assert.equal(P.notifyHour(null), -1);
  const raw = { pa: [
    item("pa-milk1", 5, "milk", 1, "l", { bb: "2026-10-15" }), item("pa-ham01", 5, "ham", 1, "pc", { bb: "2026-10-14" }),
    item("pa-old01", 5, "old", 1, "pc", { bb: "2026-10-13" }), item("pa-later", 5, "later", 1, "pc", { bb: "2026-10-20" }),
    item("pa-gone1", 5, "gone", 1, "pc", { bb: "2026-10-15" }), item("pa-milk1", 3, "milk OLD", 1, "l", { bb: "2026-10-15" }),
    { id: "x", m: 1, n: "bad", bb: "2026-10-15" }, null
  ], tombs: { "pa-gone1": 5 } };
  assert.deepEqual(j(P.expiryNotice(raw, "2026-10-14")), [{ id: "pa-ham01", n: "ham", d: 0 }, { id: "pa-milk1", n: "milk", d: 1 }]);
  assert.deepEqual(j(P.expiryNotice(null, "2026-10-14")), []);
  const soon = P.expiring(raw.pa.filter(Boolean).filter((x) => /^pa-/.test(x.id) && x.m === 5), "2026-10-14", 3);
  assert.deepEqual(j(soon.map((x) => x.n)), ["old", "ham", "gone", "milk"]);
});
