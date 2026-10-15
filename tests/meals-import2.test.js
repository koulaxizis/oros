// Meal Planner wave 6: more recipe sources in meals/import.js — Mela
// (.melarecipe / .melarecipes), Recipe Keeper (ZIP with recipes.html
// microdata), Nextcloud Cookbook (ZIP of folders with recipe.json),
// Cooklang (.cook), Crouton (.crumb), MyCookbook (.mcb) — and the
// stable ids of a batch import.
// Fixtures are built here from the documented shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ctx = { Uint8Array, TextDecoder, TextEncoder, DecompressionStream, DataView, ArrayBuffer, Promise, Math };
vm.createContext(ctx);
for (const f of ["meals/core.js", "meals/import.js", "atelier/zip.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const C = ctx.OrosMealsCore;
const I = ctx.OrosMealsImport;
const Z = ctx.AtelierZip;
const K = require(path.join(ROOT, "importkit.js"));
const j = (x) => JSON.parse(JSON.stringify(x));
const enc = (s) => new TextEncoder().encode(typeof s === "string" ? s : JSON.stringify(s));

// ---------- Mela ----------
const MELA = {
  id: "5D2E-AB", title: "Spanakopita", text: "A **Greek** classic.",
  ingredients: "# Filling\n500 g spinach\n200 g feta, crumbled\n# Pastry\n1 pack filo",
  instructions: "# Filling\nWash the spinach.\nMix with the [feta](https://x.example/feta).\n# Bake\nLayer and bake 45 min.",
  notes: "Freezes well.", yield: "6 servings", prepTime: "20 min", cookTime: "45 min", totalTime: "",
  categories: ["Main", "Greek"], link: "https://example.com/spanakopita",
  images: ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"], favorite: true
};

test("Mela: one .melarecipe, groups and sections from # lines, images never kept", async () => {
  const list = j(await I.fromBytes(enc(MELA), "Spanakopita.melarecipe", Z));
  assert.equal(list.length, 1);
  const d = list[0];
  assert.equal(d.fmt, "mela");
  assert.equal(d.t, "Spanakopita");
  assert.equal(d.sv, 6); assert.equal(d.pt, 20); assert.equal(d.ct, 45);
  assert.equal(d.c, "main");
  assert.deepEqual(d.tg, ["Main", "Greek"]);
  assert.equal(d.ig.length, 3);
  assert.equal(d.ig[0].g, "Filling"); assert.equal(d.ig[2].g, "Pastry");
  assert.equal(d.ig[1].n, "feta"); assert.equal(d.ig[1].x, "crumbled");
  assert.deepEqual(d.st, ["Filling: Wash the spinach.", "Mix with the feta.", "Bake: Layer and bake 45 min."]);
  assert.equal(d.no, "A Greek classic.\n\nFreezes well.");
  assert.equal(d.src, "https://example.com/spanakopita");
  assert.equal(d.img, "");
  assert.ok(!JSON.stringify(d).includes("iVBOR"));
});

test("Mela: .melarecipes is a ZIP of .melarecipe JSON", async () => {
  const two = Object.assign({}, MELA, { title: "Tzatziki", ingredients: "1 cucumber\n500 g yogurt", instructions: "Grate.\nMix.", categories: [] });
  const zip = Z.write([{ name: "a.melarecipe", data: enc(MELA) }, { name: "b.melarecipe", data: enc(two) }, { name: "c.melarecipe", data: enc("{bad") }]);
  const list = j(await I.fromBytes(zip, "Export.melarecipes", Z));
  assert.deepEqual(list.map((d) => d.t), ["Spanakopita", "Tzatziki"]);
  assert.ok(list.every((d) => d.fmt === "mela"));
});

// ---------- Recipe Keeper ----------
const RK_HTML = `<!DOCTYPE html><html><head><title>Recipe Keeper</title><script>alert(1)</script></head><body>
<div class="recipe-details">
  <h2 itemprop="name">Lentil soup &amp; lemon</h2>
  <meta content="False" itemprop="recipeIsFavourite">
  <table><tr><td>Course:</td><td><span itemprop="recipeCourse">Soup</span></td></tr>
  <tr><td>Categories:</td><td><span itemprop="recipeCategory">Vegan</span><meta content="Winter" itemprop="recipeCategory"></td></tr>
  <tr><td>Serving size:</td><td><span itemprop="recipeYield">4 portions</span></td></tr></table>
  <meta content="PT10M" itemprop="prepTime"><meta content="PT40M" itemprop="cookTime">
  <span itemprop="recipeSource">https://example.org/lentils</span>
  <img src="images/lentils.jpg" itemprop="photo0">
  <div itemprop="recipeIngredients"><p>250 g red lentils</p><p>1 onion, chopped</p><div><p>2 tbsp olive oil</p></div></div>
  <div itemprop="recipeDirections"><p>Fry the onion in the oil.</p><p>Add lentils and <b>1 l</b> water; simmer 30 min.</p></div>
  <div itemprop="recipeNotes"><p>Squeeze lemon <img src=x onerror=alert(1)> at the end.</p></div>
</div>
<div class="recipe-details">
  <h2 itemprop="name">Toast</h2>
  <div itemprop="recipeIngredients"><p>2 slices bread</p></div>
  <div itemprop="recipeDirections"><p>Toast it.</p></div>
</div>
</body></html>`;

test("Recipe Keeper: recipes.html microdata in the export ZIP (text scan without DOMParser)", async () => {
  const zip = Z.write([{ name: "recipes.html", data: enc(RK_HTML) }, { name: "images/lentils.jpg", data: new Uint8Array([255, 216, 255]) }]);
  const list = j(await I.fromBytes(zip, "RecipeKeeper.zip", Z));
  assert.equal(list.length, 2);
  const d = list[0];
  assert.equal(d.fmt, "recipekeeper");
  assert.equal(d.t, "Lentil soup & lemon");
  assert.equal(d.c, "soup"); assert.deepEqual(d.tg, ["Vegan", "Winter"]);
  assert.equal(d.sv, 4); assert.equal(d.pt, 10); assert.equal(d.ct, 40);
  assert.deepEqual(d.ig.map((i) => i.n), ["red lentils", "onion", "olive oil"]);
  assert.deepEqual(d.st, ["Fry the onion in the oil.", "Add lentils and 1 l water; simmer 30 min."]);
  assert.equal(d.no, "Squeeze lemon at the end.");
  assert.equal(d.src, "https://example.org/lentils");
  assert.equal(d.img, "");
  assert.ok(!/alert|<|onerror/.test(JSON.stringify(d)));
  assert.equal(list[1].t, "Toast");
});

test("Recipe Keeper: pasted page source is recognised as data", () => {
  assert.equal(I.looksLikeData(RK_HTML), true);
  assert.equal(I.fromText(RK_HTML, "").length, 2);
});

// ---------- Nextcloud Cookbook ----------
test("Nextcloud Cookbook: folders with recipe.json go through the schema.org path", async () => {
  const r1 = { "@context": "http://schema.org", "@type": "Recipe", name: "Pancakes", recipeYield: 4,
    prepTime: "PT0H10M0S", cookTime: "PT0H20M0S", recipeCategory: "Breakfast", keywords: "sweet,quick",
    recipeIngredient: ["200 g flour", "2 eggs", "300 ml milk"], recipeInstructions: ["Whisk.", "Fry."],
    url: "https://example.net/pancakes", image: "https://example.net/p.jpg" };
  const r2 = { "@context": "http://schema.org", "@type": "Recipe", name: "Salad",
    recipeIngredient: ["1 lettuce"], recipeInstructions: [{ "@type": "HowToStep", text: "Tear." }] };
  const zip = Z.write([
    { name: "Recipes/Pancakes/recipe.json", data: enc(r1) }, { name: "Recipes/Pancakes/full.jpg", data: new Uint8Array([1, 2]) },
    { name: "Recipes/Salad/recipe.json", data: enc(r2) }
  ]);
  const list = j(await I.fromBytes(zip, "Recipes.zip", Z));
  assert.deepEqual(list.map((d) => d.t), ["Pancakes", "Salad"]);
  assert.ok(list.every((d) => d.fmt === "nextcloud"));
  const d = list[0];
  assert.equal(d.sv, 4); assert.equal(d.pt, 10); assert.equal(d.ct, 20); assert.equal(d.c, "breakfast");
  assert.deepEqual(d.tg, ["sweet", "quick"]);
  assert.deepEqual(d.st, ["Whisk.", "Fry."]);
  assert.equal(list[1].st[0], "Tear.");
});

// ---------- Cooklang ----------
const COOK = `>> servings: 2
>> prep time: 10 minutes
>> source: https://cooklang.example/pasta
>> tags: quick, pasta
-- a comment that is never shown
= Sauce
Heat @olive oil{2%tbsp} in a #large pan{}. Add @garlic{2%cloves}(crushed) and fry for ~{1%minute}.

Add @tomatoes{400%g} and @salt. [- block
comment -]Simmer ~sauce{15%minutes}.

= Pasta
Boil @spaghetti{200%g} in #pot until done.`;

test("Cooklang: metadata, ingredients with qty%unit, cookware, timers, sections, comments", async () => {
  const list = j(await I.fromBytes(enc(COOK), "Tomato_pasta.cook", Z));
  assert.equal(list.length, 1);
  const d = list[0];
  assert.equal(d.fmt, "cooklang");
  assert.equal(d.t, "Tomato pasta");
  assert.equal(d.sv, 2); assert.equal(d.pt, 10);
  assert.equal(d.src, "https://cooklang.example/pasta");
  assert.deepEqual(d.tg, ["quick", "pasta"]);
  assert.deepEqual(d.ig.map((i) => [i.q, i.u, i.n, i.g]), [
    [2, "tbsp", "olive oil", "Sauce"], [2, "clove", "garlic", "Sauce"], [400, "g", "tomatoes", "Sauce"],
    [null, "", "salt", "Sauce"], [200, "g", "spaghetti", "Pasta"]
  ].map(([q, u, n, g]) => [q === null ? d.ig[3].q : q, u, n, g]));
  assert.equal(d.ig[1].x, "crushed");
  assert.deepEqual(d.st, [
    "Sauce: Heat olive oil in a large pan. Add garlic and fry for 1 minute.",
    "Add tomatoes and salt. Simmer 15 minutes.",
    "Pasta: Boil spaghetti in pot until done."
  ]);
  assert.ok(!JSON.stringify(d).includes("comment"));
});

test("Cooklang: YAML front matter, a ZIP of .cook files, paste detection", async () => {
  const yaml = "---\ntitle: Eggs\nservings: 1\ntags:\n  - breakfast\n---\nBoil @eggs{2} for ~{7%minutes}.\n";
  const zip = Z.write([{ name: "cook/Eggs.cook", data: enc(yaml) }, { name: "cook/Tomato pasta.cook", data: enc(COOK) }]);
  const list = j(await I.fromBytes(zip, "recipes.zip", Z));
  assert.deepEqual(list.map((d) => d.t), ["Eggs", "Tomato pasta"]);
  assert.equal(list[0].sv, 1); assert.deepEqual(list[0].tg, ["breakfast"]); assert.equal(list[0].c, "");
  assert.equal(list[0].st[0], "Boil eggs for 7 minutes.");
  assert.equal(list[0].ig[0].q, 2);
  assert.equal(I.isCooklang(COOK), true);
  assert.equal(I.isCooklang("2 eggs\nBoil them."), false);
  assert.equal(I.looksLikeData(COOK), true);
  assert.equal(I.fromText(COOK, "").length, 1);
});

// ---------- Crouton ----------
const CRUMB = {
  name: "Chicken curry", uuid: "A-1", serves: 4, duration: 15, cookingDuration: 35, defaultScale: 1,
  ingredients: [
    { order: 2, uuid: "i2", ingredient: { name: "coconut milk", uuid: "x" }, quantity: { amount: 400, quantityType: "MILLS" } },
    { order: 1, uuid: "i1", ingredient: { name: "chicken thighs", uuid: "y" }, quantity: { amount: 600, quantityType: "GRAMS" } },
    { order: 3, uuid: "i3", ingredient: { name: "curry paste", uuid: "z" }, quantity: { amount: 2, quantityType: "TABLESPOON" } },
    { order: 4, uuid: "i4", ingredient: { name: "limes", uuid: "w" }, quantity: { amount: 2, quantityType: "ITEM" } }
  ],
  steps: [
    { order: 0, step: "Cook", isSection: true }, { order: 1, step: "Brown the chicken.", isSection: false },
    { order: 2, step: "Add paste and milk; simmer.", isSection: false }
  ],
  notes: "Serve with rice.", sourceName: "Grandma", webLink: "https://example.com/curry",
  tags: [{ name: "Dinner" }], images: ["/9j/4AAQSkZJRgABAQ"]
};

test("Crouton: a .crumb (ordered ingredients, units, sections) and a ZIP of them", async () => {
  const d = j(await I.fromBytes(enc(CRUMB), "Chicken curry.crumb", Z))[0];
  assert.equal(d.fmt, "crouton");
  assert.equal(d.t, "Chicken curry"); assert.equal(d.sv, 4); assert.equal(d.pt, 15); assert.equal(d.ct, 35);
  assert.deepEqual(d.ig.map((i) => [i.q, i.u, i.n]), [[600, "g", "chicken thighs"], [400, "ml", "coconut milk"], [2, "tbsp", "curry paste"], [2, "", "limes"]]);
  assert.deepEqual(d.st, ["Cook: Brown the chicken.", "Add paste and milk; simmer."]);
  assert.equal(d.src, "https://example.com/curry"); assert.equal(d.no, "Serve with rice.");
  assert.equal(d.c, ""); assert.deepEqual(d.tg, ["Dinner"]);
  assert.ok(!JSON.stringify(d).includes("9j"));
  const zip = Z.write([{ name: "Chicken curry.crumb", data: enc(CRUMB) }, { name: "Two.crumb", data: enc(Object.assign({}, CRUMB, { name: "Two", webLink: "" })) }]);
  const list = j(await I.fromBytes(zip, "Crouton.zip", Z));
  assert.deepEqual(list.map((x) => x.t), ["Chicken curry", "Two"]);
  assert.equal(list[1].src, "Grandma");
});

test("Crouton is not taken for Tandoor, nor Tandoor for Crouton", () => {
  const tandoor = { name: "T", steps: [{ name: "", instruction: "Do.", ingredients: [{ food: { name: "salt" }, amount: 1, unit: { name: "g" } }] }] };
  assert.equal(I.fromJson(tandoor, "")[0].fmt, "tandoor");
  assert.equal(I.fromJson(CRUMB, "")[0].fmt, "crouton");
});

// ---------- MyCookbook ----------
const MCB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cookbook>
<recipe>
<title>Moussaka</title>
<preptime>45 min</preptime>
<cooktime>1h</cooktime>
<quantity>8</quantity>
<ingredient><li>3 aubergines</li><li>500 g minced beef</li><li><![CDATA[1 l béchamel <b>sauce</b>]]></li></ingredient>
<recipetext><li>Fry the aubergines.</li><li>Layer &amp; bake.</li></recipetext>
<comments><li>Better the next day.</li></comments>
<url>https://example.gr/moussaka</url>
<category>Main dishes</category>
<category>Greek</category>
<imagepath>images/m.jpg</imagepath>
</recipe>
<recipe><title>Empty</title></recipe>
<recipe><title>Frappe</title><ingredient>2 tsp instant coffee
water</ingredient><recipetext>Shake it.</recipetext><category>Drinks</category></recipe>
</cookbook>`;

test("MyCookbook: .mcb is a ZIP with the <cookbook> XML", async () => {
  const zip = Z.write([{ name: "mycookbook.xml", data: enc(MCB_XML) }, { name: "images/m.jpg", data: new Uint8Array([1]) }]);
  const list = j(await I.fromBytes(zip, "Export.mcb", Z));
  assert.deepEqual(list.map((d) => d.t), ["Moussaka", "Frappe"]);
  const d = list[0];
  assert.equal(d.fmt, "mycookbook");
  assert.equal(d.sv, 8); assert.equal(d.pt, 45); assert.equal(d.ct, 60);
  assert.equal(d.c, "main"); assert.deepEqual(d.tg, ["Main dishes", "Greek"]);
  assert.deepEqual(d.ig.map((i) => i.n), ["aubergines", "minced beef", "béchamel sauce"]);
  assert.deepEqual(d.st, ["Fry the aubergines.", "Layer & bake."]);
  assert.equal(d.no, "Better the next day."); assert.equal(d.src, "https://example.gr/moussaka");
  assert.equal(list[1].c, "drink"); assert.equal(list[1].ig.length, 2);
});

// ---------- batch: stable ids ----------
test("stable ids: imp- + hash of source and title, same as OrosImportKit.hash; batch dedupes and marks stored", async () => {
  const d = I.fromJson(MELA, "")[0];
  const id = I.idFor(d);
  assert.equal(id, "imp-" + K.hash("mela\n" + C.fold("Spanakopita")));
  assert.ok(C.ID_RE.test(id));
  assert.equal(I.idFor(Object.assign({}, d, { t: "SPANAKOPITA" })), id);       // title folded
  assert.notEqual(I.idFor(Object.assign({}, d, { fmt: "paprika" })), id);       // per source
  const zip = Z.write([{ name: "a.melarecipe", data: enc(MELA) }, { name: "b.melarecipe", data: enc(MELA) },
    { name: "c.melarecipe", data: enc(Object.assign({}, MELA, { title: "Other" })) }]);
  const list = await I.fromBytes(zip, "x.melarecipes", Z);
  const b = j(I.prepareBatch(list, [id]));
  assert.equal(b.length, 2);
  assert.deepEqual(b.map((x) => x.stored), [true, false]);
  assert.equal(b[1].d.t, "Other");
  // a stored recipe made from a draft with its id passes normRecipe; fmt is dropped
  const r = C.normRecipe(Object.assign({}, b[1].d, { id: b[1].id, m: 1, fv: 0 }));
  assert.ok(r); assert.equal(r.id, b[1].id); assert.ok(!("fmt" in r));
});

test("every format has a display name", () => {
  for (const k of ["schema", "paprika", "mealie", "tandoor", "mela", "recipekeeper", "nextcloud", "cooklang", "crouton", "mycookbook"]) {
    assert.equal(typeof I.FORMATS[k], "string");
  }
});
