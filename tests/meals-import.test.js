// Meal Planner wave 2: ranges and unit conversion (meals/core.js),
// supermarket sections, and recipe import (meals/import.js): schema.org
// JSON-LD from a page, Paprika (.paprikarecipes = ZIP of gzipped
// JSON), Mealie and Tandoor exports.
// Run: node --test tests/
//
// core.js, import.js and the shared ZIP reader (atelier/zip.js) are
// evaluated as is in one fresh context.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const ctx = { Uint8Array, TextDecoder, TextEncoder, DecompressionStream, DataView, ArrayBuffer, Promise };
vm.createContext(ctx);
for (const f of ["meals/core.js", "meals/import.js", "atelier/zip.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const C = ctx.OrosMealsCore;
const I = ctx.OrosMealsImport;
const Z = ctx.AtelierZip;
const j = (x) => JSON.parse(JSON.stringify(x));

// ---------- quantities ----------
test("ranges: lower and upper end, 'to' / 'έως', unicode fractions, fraction slash", () => {
  assert.deepEqual(j(C.parseRange("2-3")), { lo: 2, hi: 3 });
  assert.deepEqual(j(C.parseRange("1½–2")), { lo: 1.5, hi: 2 });
  assert.equal(C.parseQty("2-3"), 3);                       // unchanged: the upper end
  assert.equal(C.parseQty("⅝"), 0.625);
  assert.equal(C.parseQty("1⁄2"), 0.5);
  let i = j(C.parseIngLine("2-3 eggs"));
  assert.deepEqual(i, { q: 3, q0: 2, u: "", n: "eggs", x: "", g: "" });
  i = j(C.parseIngLine("2 to 3 cloves garlic, crushed"));
  assert.equal(i.q0, 2); assert.equal(i.q, 3); assert.equal(i.u, "clove"); assert.equal(i.x, "crushed");
  i = j(C.parseIngLine("1 έως 2 κ.σ. μέλι"));
  assert.equal(i.q0, 1); assert.equal(i.q, 2); assert.equal(i.u, "tbsp");
  i = j(C.parseIngLine("0,5 κιλό αλεύρι"));
  assert.equal(i.q, 0.5); assert.equal(i.u, "kg"); assert.ok(!("q0" in i));
  i = j(C.parseIngLine("1⁄2 cup milk"));
  assert.equal(i.q, 0.5); assert.equal(i.u, "cup");
});

test("scaling keeps ranges and fractions, Greek decimal comma", () => {
  const eggs = C.parseIngLine("2-3 eggs");
  assert.equal(C.ingToLine(eggs, "en", 2), "4–6 eggs");
  assert.equal(C.ingToLine(eggs, "en", 0.5), "1–1½ eggs");
  const fl = C.parseIngLine("1,5 κιλό πατάτες");
  assert.equal(C.ingToLine(fl, "el", 0.5), "¾ κιλό πατάτες");
  assert.equal(C.ingToLine(C.parseIngLine("300 γρ. ρύζι"), "el", 1 / 3), "100 γρ. ρύζι");
  assert.equal(C.ingToLine(C.parseIngLine("⅓ cup sugar"), "en", 3), "1 cup sugar");
});

test("unit conversion: metric ↔ US, spoons stay, plural only above one", () => {
  const L = (s, sys, f) => C.ingToLine(C.parseIngLine(s), "en", f || 1, sys);
  assert.equal(L("1/2 cup milk", "metric"), "120 ml milk");
  assert.equal(L("8 oz cheddar", "metric"), "225 g cheddar");
  assert.equal(L("2 lb beef", "metric"), "905 g beef");
  assert.equal(L("3 lb beef", "metric"), "1.4 kg beef");
  assert.equal(L("4 fl oz cream", "metric"), "120 ml cream");
  assert.equal(L("2 tbsp oil", "metric"), "2 tbsp oil");
  assert.equal(L("250 ml milk", "us"), "1 cup milk");
  assert.equal(L("5 ml vanilla", "us"), "1 tsp vanilla");
  assert.equal(L("30 ml lemon juice", "us"), "2 tbsp lemon juice");
  assert.equal(L("200 g feta", "us"), "7.1 oz feta");
  assert.equal(L("1 kg potatoes", "us"), "2.2 lb potatoes");
  assert.equal(L("8 oz cheddar", ""), "8 oz cheddar");      // as written
  assert.equal(L("8 oz cheddar", "us", 2), "16 oz cheddar");
  // ranges convert both ends
  assert.equal(L("1½–2 cups flour", "metric"), "360–480 ml flour");
  const c = j(C.convertQty(1, null, "pinch", "us"));
  assert.deepEqual(c, { q: 1, q0: null, u: "pinch" });
});

test("oven temperatures in steps", () => {
  assert.equal(C.convertTemps("Bake at 180 °C for 20 minutes.", "us"), "Bake at 355 °F for 20 minutes.");
  assert.equal(C.convertTemps("Preheat the oven to 350°F.", "metric"), "Preheat the oven to 175 °C.");
  assert.equal(C.convertTemps("Ψήνουμε στους 200 βαθμούς.", "us"), "Ψήνουμε στους 390 °F.");
  assert.equal(C.convertTemps("Bake at 400 degrees", "metric"), "Bake at 205 °C");
  assert.equal(C.convertTemps("180 °C (350 °F)", "us"), "180 °C (350 °F)");       // both given: left alone
  assert.equal(C.convertTemps("Bake at 180 °C", ""), "Bake at 180 °C");
  assert.equal(C.convertTemps("Simmer for 30 minutes", "us"), "Simmer for 30 minutes");
});

test("normalize: q0 and img only when valid; old recipes keep their exact JSON", () => {
  assert.deepEqual(j(C.normIng({ q: 3, q0: 2, u: "", n: "eggs" })), { q: 3, q0: 2, u: "", n: "eggs", x: "", g: "" });
  assert.ok(!("q0" in j(C.normIng({ q: 3, q0: 3, n: "eggs" }))));
  assert.ok(!("q0" in j(C.normIng({ q: null, q0: 2, n: "eggs" }))));
  const base = { id: "r-abc", m: 5, t: "Soup", sv: 4, ig: [{ q: 1, u: "kg", n: "beans" }], st: ["Boil."] };
  const old = j(C.normRecipe(base));
  assert.ok(!("img" in old));
  assert.equal(JSON.stringify(C.normRecipe(old)), JSON.stringify(old));
  assert.equal(C.normRecipe(Object.assign({}, base, { img: "https://x.example/p.jpg" })).img, "https://x.example/p.jpg");
  assert.ok(!("img" in j(C.normRecipe(Object.assign({}, base, { img: "javascript:alert(1)" })))));
  assert.ok(!("img" in j(C.normRecipe(Object.assign({}, base, { img: "data:image/png;base64,AAA" })))));
  const merged = C.mergeMeals({ rc: [Object.assign({}, base, { img: "https://x.example/p.jpg" })] }, { rc: [] });
  assert.equal(merged.rc[0].img, "https://x.example/p.jpg");
});

// ---------- shopping sections ----------
test("sections: household, frozen and canned words, phrases inside names (EN and EL)", () => {
  assert.ok(C.AISLES.indexOf("household") >= 0);
  assert.equal(C.AISLES[C.AISLES.length - 1], "other");
  const a = (n) => C.lookup(n).aisle;
  assert.equal(a("baking paper"), "household");
  assert.equal(a("roll baking paper"), "household");
  assert.equal(a("χαρτί κουζίνας"), "household");
  assert.equal(a("απορρυπαντικό πιάτων"), "household");
  assert.equal(a("frozen spinach"), "frozen");
  assert.equal(a("κατεψυγμένος αρακάς"), "frozen");
  assert.equal(a("canned tomatoes"), "pantry");
  assert.equal(a("tomatoes"), "produce");
  assert.equal(a("coconut milk"), "pantry");
  assert.equal(a("milk"), "dairy");
  assert.equal(a("dried oregano"), "spices");
  assert.equal(a("ψωμάκια"), "bakery");
  // a user's section choice is synced like the others
  const d = C.mergeMeals({ rc: [], ai: { "paper": { a: "household", m: 3 } } }, { rc: [], ai: { "paper": { a: "other", m: 2 } } });
  assert.equal(d.ai.paper.a, "household");
});

test("shopping: duplicates merge across recipes and US/metric units; units follow the choice", () => {
  const r1 = { id: "r-one", m: 1, t: "A", sv: 2, ig: [C.parseIngLine("8 oz cheddar"), C.parseIngLine("1 cup milk"), C.parseIngLine("2-3 eggs")], st: [] };
  const r2 = { id: "r-two", m: 1, t: "B", sv: 2, ig: [C.parseIngLine("100 g cheddar"), C.parseIngLine("2 eggs")], st: [] };
  const r3 = { id: "r-three", m: 1, t: "C", sv: 2, ig: [C.parseIngLine("1 lb beef"), C.parseIngLine("8 oz beef")], st: [] };
  const data = C.mergeMeals({ rc: [r1, r2, r3], pl: {
    "2026-10-12|d": { m: 1, it: [{ r: "r-one", sv: 2 }, { r: "r-two", sv: 4 }] },
    "2026-10-13|d": { m: 1, it: [{ r: "r-three", sv: 2 }] } } }, {});
  const get = (id) => data.rc.find((r) => r.id === id) || null;
  const by = (list) => Object.fromEntries(list.items.map((i) => [i.key, i.qty]));
  let s = by(C.buildShop(data, get, "2026-10-12", null, "en", ""));
  assert.equal(s.cheddar, "425 g");                   // 227 g + 200 g, mixed → metric
  assert.equal(s.egg, "7");                           // 3 (upper end) + 4
  assert.equal(s.beef, "1½ lb");                      // only US units → stays US
  assert.equal(s.milk, "1 cup");
  s = by(C.buildShop(data, get, "2026-10-12", null, "en", "us"));
  assert.equal(s.cheddar, "15 oz");
  s = by(C.buildShop(data, get, "2026-10-12", null, "en", "metric"));
  assert.equal(s.beef, "680 g");
});

// ---------- import: web pages ----------
const PAGE = `<!doctype html><html><head><title>x</title>
<script>window.evil = 1;</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","name":"Site"},
 {"@type":["Recipe","NewsArticle"],"name":"Spanakopita &amp; friends","recipeYield":["6","6 servings"],
  "prepTime":"PT30M","totalTime":"PT1H45M","recipeCategory":"Main course","recipeCuisine":"Greek",
  "keywords":"pie, spinach, feta","suitableForDiet":"https://schema.org/VegetarianDiet",
  "image":[{"@type":"ImageObject","url":"https://img.example/s.jpg"}],
  "description":"<p>A classic &#8211; crisp.</p>",
  "recipeIngredient":["500 g spinach","200 g feta, crumbled","1 pack filo pastry","4 tbsp olive oil"],
  "recipeInstructions":[
   {"@type":"HowToSection","name":"Filling","itemListElement":[
     {"@type":"HowToStep","text":"Wash and chop the spinach."},
     {"@type":"HowToStep","text":"Mix with the feta."}]},
   {"@type":"HowToSection","name":"Pie","itemListElement":[
     {"@type":"HowToStep","text":"Layer the filo, brushing with oil.<br>Bake at 180 °C for 45 minutes."}]}
  ]}]}</script>
<script type="application/ld+json">not json</script>
</head><body><h1>Spanakopita</h1></body></html>`;

test("JSON-LD: @graph, type arrays, sections, durations, yield, image link, entities", () => {
  assert.equal(I.ldBlocks(PAGE).length, 2);
  const list = j(I.fromText(PAGE, "https://site.example/spanakopita"));
  assert.equal(list.length, 1);
  const d = list[0];
  assert.equal(d.t, "Spanakopita & friends");
  assert.equal(d.sv, 6);
  assert.equal(d.pt, 30);
  assert.equal(d.ct, 75);                                  // total − prep
  assert.equal(d.c, "main");
  assert.deepEqual(d.tg, ["Greek", "pie", "spinach", "feta"]);
  assert.deepEqual(d.dt, ["veg"]);
  assert.equal(d.img, "https://img.example/s.jpg");
  assert.equal(d.src, "https://site.example/spanakopita");
  assert.equal(d.no, "A classic – crisp.");
  assert.equal(d.ig.length, 4);
  assert.deepEqual(d.ig[1], { q: 200, u: "g", n: "feta", x: "crumbled", g: "" });
  assert.deepEqual(d.st, ["Filling: Wash and chop the spinach.", "Mix with the feta.",
                          "Pie: Layer the filo, brushing with oil.", "Bake at 180 °C for 45 minutes."]);
  // what the editor would save is a valid recipe
  assert.ok(C.normRecipe(Object.assign({ id: "r-imp1", m: 1 }, d)));
});

test("JSON-LD: arrays, plain string steps, ISO P..DT, numeric yield; nothing found → []", () => {
  const ld = [{ "@type": "Person", name: "x" },
    { "@type": "Recipe", name: "Toast", recipeYield: 2, cookTime: "P0DT0H5M", prepTime: "PT1M",
      recipeIngredient: ["2 slices bread"], recipeInstructions: "1. Toast the bread.\n2. Eat it.",
      image: "https://img.example/t.png", url: "https://a.example/toast" }];
  const html = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const d = j(I.fromText(html, ""))[0];
  assert.equal(d.sv, 2); assert.equal(d.ct, 5); assert.equal(d.pt, 1);
  assert.deepEqual(d.st, ["Toast the bread.", "Eat it."]);
  assert.equal(d.src, "https://a.example/toast");
  assert.deepEqual(j(I.fromText("<html><body>No recipe here</body></html>", "")), []);
  assert.deepEqual(j(I.fromText("<script type=\"application/ld+json\">{\"@type\":\"Article\"}</script>", "")), []);
  // a pasted JSON-LD object works too
  assert.equal(I.fromText(JSON.stringify(ld[1]), "")[0].t, "Toast");
  assert.ok(I.looksLikeData(html));
  assert.ok(!I.looksLikeData("Pancakes\n2 eggs\nMix."));
});

test("durations and servings in many shapes", () => {
  assert.equal(I.minutes("PT1H30M"), 90);
  assert.equal(I.minutes("PT0.5H"), 30);
  assert.equal(I.minutes("P1DT2H"), 1560);
  assert.equal(I.minutes("1 hour 15 mins"), 75);
  assert.equal(I.minutes("45 λεπτά"), 45);
  assert.equal(I.minutes("1:20"), 80);
  assert.equal(I.minutes(""), null);
  assert.equal(I.servings("Serves 4-6"), 4);
  assert.equal(I.servings(["", "8 portions"]), 8);
  assert.equal(I.servings(500), 50);
  assert.equal(I.servings("a few"), null);
});

test("strings from pages are plain text: tags dropped, entities decoded, no markup survives", () => {
  assert.equal(I.txt("<b>Hot</b> &amp; <i>sour</i>"), "Hot & sour");
  assert.equal(I.txt("&lt;script&gt;alert(1)&lt;/script&gt;Soup"), "alert(1)Soup");
  assert.equal(I.txt("5&#x00B0;C &frac12; cup"), "5°C ½ cup");
  const evil = { "@type": "Recipe", name: "<img src=x onerror=alert(1)>Cake", recipeIngredient: ["1 egg"],
                 recipeInstructions: [{ "@type": "HowToStep", text: "<script>x()</script>Bake." }], image: "javascript:alert(1)" };
  const d = j(I.fromJson(evil, ""))[0];
  assert.equal(d.t, "Cake");
  assert.deepEqual(d.st, ["x()Bake."]);
  assert.equal(d.img, "");
});

// ---------- import: Paprika, Mealie, Tandoor ----------
const PAPRIKA = {
  uid: "A1", name: "Lemon Cake", servings: "8 servings", prep_time: "20 mins", cook_time: "45 min", total_time: "",
  ingredients: "200 g flour\n2 eggs\n\nFor the glaze:\n100 g sugar\n1 lemon, juiced",
  directions: "Mix everything.\n\nBake at 180°C for 45 minutes.", notes: "Keeps 3 days.", description: "Bright.",
  source: "Grandma", source_url: "https://cake.example/lemon", categories: ["Dessert", "Baking"],
  image_url: "https://cake.example/l.jpg", photo_data: "AAAA", rating: 5
};
const gz = (o) => new Uint8Array(zlib.gzipSync(Buffer.from(JSON.stringify(o))));

test("Paprika: one recipe and a .paprikarecipes archive (ZIP of gzipped JSON)", async () => {
  const d = j(I.fromPaprika(PAPRIKA));
  assert.equal(d.t, "Lemon Cake"); assert.equal(d.sv, 8); assert.equal(d.pt, 20); assert.equal(d.ct, 45);
  assert.equal(d.c, "dessert"); assert.deepEqual(d.tg, ["Dessert", "Baking"]);
  assert.equal(d.ig.length, 4); assert.equal(d.ig[2].g, "For the glaze"); assert.equal(d.ig[3].x, "juiced");
  assert.deepEqual(d.st, ["Mix everything.", "Bake at 180°C for 45 minutes."]);
  assert.equal(d.no, "Bright.\n\nKeeps 3 days."); assert.equal(d.src, "https://cake.example/lemon");
  assert.equal(d.img, "https://cake.example/l.jpg");
  const second = Object.assign({}, PAPRIKA, { name: "Bread", ingredients: "500 g flour", directions: "Knead." });
  const zip = Z.write([{ name: "Lemon Cake.paprikarecipe", data: gz(PAPRIKA) }, { name: "Bread.paprikarecipe", data: gz(second) },
                       { name: "junk.paprikarecipe", data: new Uint8Array([1, 2, 3]) }]);
  const list = j(await I.fromBytes(zip, "My Recipes.paprikarecipes", Z));
  assert.deepEqual(list.map((x) => x.t), ["Lemon Cake", "Bread"]);   // a bad entry is skipped
  const one = j(await I.fromBytes(gz(PAPRIKA), "Lemon Cake.paprikarecipe", Z));
  assert.equal(one.length, 1);
});

test("Mealie JSON: structured ingredients, titled steps and notes", async () => {
  const m = { id: "x", name: "Chili", recipeYield: "4 servings", prepTime: "15 minutes", performTime: "PT1H",
    orgURL: "https://chili.example", tags: [{ name: "Spicy" }], recipeCategory: [{ name: "Dinner" }],
    recipeIngredient: [
      { title: "Base", quantity: 1, unit: { name: "lb" }, food: { name: "ground beef" }, note: "lean", originalText: "" },
      { quantity: 2, unit: null, food: { name: "onions" }, note: "chopped" },
      { display: "1 can kidney beans", quantity: 0 }],
    recipeInstructions: [{ title: "Brown", text: "Brown the beef." }, { text: "Add the rest.\nSimmer 45 minutes." }],
    notes: [{ title: "Tip", text: "Better the next day." }] };
  const d = j(I.fromJson(m, ""))[0];
  assert.equal(d.t, "Chili"); assert.equal(d.sv, 4); assert.equal(d.pt, 15); assert.equal(d.ct, 60);
  assert.equal(d.c, "main"); assert.deepEqual(d.tg, ["Spicy", "Dinner"]);
  assert.deepEqual(d.ig[0], { q: 1, u: "lb", n: "ground beef", x: "lean", g: "Base" });
  assert.equal(d.ig[1].n, "onions"); assert.equal(d.ig[2].u, "can");
  assert.deepEqual(d.st, ["Brown: Brown the beef.", "Add the rest.", "Simmer 45 minutes."]);
  assert.equal(d.no, "Tip: Better the next day."); assert.equal(d.src, "https://chili.example");
  // a list of them, as a .json file
  const list = j(await I.fromBytes(new TextEncoder().encode(JSON.stringify([m, Object.assign({}, m, { name: "Chili 2" })])), "x.json", Z));
  assert.equal(list.length, 2);
});

test("Tandoor: recipe.json, also one ZIP per recipe inside the export ZIP", async () => {
  const tr = { name: "Pancakes", description: "Fluffy", servings: 3, working_time: 10, waiting_time: 15,
    source_url: "https://p.example", keywords: [{ name: "Breakfast" }],
    steps: [{ name: "", instruction: "Mix the batter.", ingredients: [
      { food: { name: "Dry" }, is_header: true },
      { food: { name: "flour" }, unit: { name: "g" }, amount: 200, note: "" },
      { food: { name: "milk" }, unit: { name: "ml" }, amount: 300, note: "warm" }] },
      { name: "Cook", instruction: "Fry in butter.", ingredients: [] }] };
  const d = j(I.fromJson(tr, ""))[0];
  assert.equal(d.sv, 3); assert.equal(d.pt, 10); assert.equal(d.ct, 15);
  assert.deepEqual(d.ig[0], { q: 200, u: "g", n: "flour", x: "", g: "Dry" });
  assert.equal(d.ig[1].x, "warm");
  assert.deepEqual(d.st, ["Mix the batter.", "Cook: Fry in butter."]);
  const inner = Z.write([{ name: "recipe.json", data: JSON.stringify(tr) }, { name: "image.jpg", data: new Uint8Array([255, 216]) }]);
  const outer = Z.write([{ name: "1.zip", data: inner }, { name: "2.zip", data: inner }]);
  const list = j(await I.fromBytes(outer, "export.zip", Z));
  assert.equal(list.length, 2);
  assert.equal(list[0].t, "Pancakes");
});

test("files: a saved web page, garbage, and limits", async () => {
  const fromHtml = j(await I.fromBytes(new TextEncoder().encode(PAGE), "page.html", Z));
  assert.equal(fromHtml.length, 1);
  assert.deepEqual(j(await I.fromBytes(new TextEncoder().encode("hello"), "a.txt", Z)), []);
  await assert.rejects(I.fromBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]), "bad.zip", Z));
  // a recipe without ingredients and steps is not a recipe
  assert.deepEqual(j(I.fromJson({ "@type": "Recipe", name: "Empty" }, "")), []);
});
