// Stock "Import from another app" (stock/import.js): Shopify products
// CSV (variants by Handle, HTML → text, image rows) and Square catalog
// (CSV and .xlsx through the vendored SheetJS, locations added up);
// the plan (stable ids, the user's products kept, one count movement)
// and Undo (tombstones newer than the rows, archived when counted).
// Fixtures follow the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "stock/import.js"));
const C = require(path.join(ROOT, "stock/core.js"));
const X = require(path.join(ROOT, "vendor/xlsx.full.min.js"));

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
const TODAY = "2026-10-12";
const enc = (s) => new TextEncoder().encode(s);
const empty = () => C.merge(null, null);
const read = (s) => I.readBytes(enc(s), "f.csv");

const SHOPIFY =
  "Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Barcode,Image Src,Cost per item,Status\n" +
  "tee,Organic Tee,\"<p>Soft <b>cotton</b> &amp; fair.</p><ul><li>S–XL</li></ul><script>alert(1)</script>\",Acme,Apparel > Shirts,Shirts,\"summer, cotton\",TRUE,Color,Red,Size,M,TEE-R-M,200,shopify,5,19.90,5901234123457,https://cdn.shopify.com/tee.jpg,7.5,active\n" +
  "tee,,,,,,,,,Red,,L,TEE-R-L,200,shopify,3,19.90,,,7.5,\n" +
  "tee,,,,,,,,,,,,,,,,,,https://cdn.shopify.com/tee2.jpg,,\n" +
  "mug,Mug,<p>Big</p>,Acme,,Kitchen,,TRUE,Title,Default Title,,,MUG-1,300,shopify,0,9.5,,javascript:alert(1),,active\n";

const SQUARE =
  "Token,Item Name,Variation Name,SKU,Description,Category,Price,Current Quantity Main St,Current Quantity Harbour,Stock Alert Count Main St,GTIN,Default Unit Cost,Default Vendor Name\n" +
  "AAA,Espresso beans,Regular,ESP-1,Dark roast,Coffee,12.00,10,4,3,4006381333931,6.10,Roast Co\n" +
  "BBB,Latte cup,Large,CUP-L,,Supplies,variable,,,,,,\n" +
  "CCC,Latte cup,Small,,,Supplies,1.20,7,,,,,\n";

test("detects Shopify and keeps one product per variant", async () => {
  const r = await read(SHOPIFY);
  const res = I.parseRows(r.rows, { tags: "Ετικέτες", image: "Εικόνα" });
  assert.equal(res.source, "shopify");
  assert.deepEqual(res.items.map((x) => x.name), ["Organic Tee (Red / M)", "Organic Tee (Red / L)", "Mug"]);
  const a = res.items[0];
  assert.equal(a.sku, "TEE-R-M");
  assert.equal(a.bc, "5901234123457");
  assert.equal(a.cat, "Shirts");
  assert.equal(a.sup, "Acme");
  assert.equal(a.price, 19.9);
  assert.equal(a.cost, 7.5);
  assert.equal(a.qty, 5);
  assert.match(a.note, /^Soft cotton & fair\.\n• S–XL/);
  assert.ok(!/alert|<|>/.test(a.note.split("\n\n")[0]), "no markup or script text");
  assert.match(a.note, /Ετικέτες: summer, cotton/);
  assert.match(a.note, /Εικόνα: https:\/\/cdn\.shopify\.com\/tee\.jpg/);
  // the second variant inherits the product's fields
  assert.equal(res.items[1].cat, "Shirts");
  assert.equal(res.items[1].qty, 3);
  // only https links are kept
  assert.ok(!/javascript/.test(res.items[2].note));
});

test("htmlText decodes entities and drops tags", () => {
  assert.equal(I.htmlText("<h2>A&nbsp;b</h2><p>x &lt;y&gt; &#8364; &#x41;</p>"), "A b\nx <y> € A");
});

test("Square CSV: variations, locations added, alert level, variable price", async () => {
  const res = I.parseRows((await read(SQUARE)).rows);
  assert.equal(res.source, "square");
  assert.equal(res.locs, 2);
  const [e, l, s] = res.items;
  assert.equal(e.name, "Espresso beans");
  assert.equal(e.qty, 14);
  assert.equal(e.min, 3);
  assert.equal(e.bc, "4006381333931");
  assert.equal(e.cost, 6.1);
  assert.equal(e.sup, "Roast Co");
  assert.equal(l.name, "Latte cup (Large)");
  assert.equal(l.price, null);
  assert.equal(s.name, "Latte cup (Small)");
});

test("Square .xlsx through SheetJS (only loaded for a zip), title row above", async () => {
  const aoa = [["Square catalog"], ...SQUARE.trim().split("\n").map((l) => l.split(","))];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), "Items");
  const bytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
  let asked = 0;
  const r = await I.readBytes(bytes, "catalog.xlsx", () => { asked++; return Promise.resolve(X); });
  assert.equal(asked, 1);
  const res = I.parseRows(r.rows);
  assert.equal(res.source, "square");
  assert.equal(res.items.length, 3);
  // no reader → a clear error, never a crash
  assert.deepEqual(await I.readBytes(bytes, "c.xlsx", () => Promise.reject(new Error("x"))), { error: "lib" });
  assert.deepEqual(await I.readBytes(bytes, "c.xlsx", null), { error: "bad" });
  // a plain sheet goes back to CSV for the app's own importer
  const plain = [["Name", "SKU", "Quantity"], ["Bolt, M6", "B6", 100]];
  assert.equal(I.toCsv(plain), "Name,SKU,Quantity\r\n\"Bolt, M6\",B6,100");
  assert.equal(C.importPlan(empty(), I.toCsv(plain), { newId: () => "abcdef12", now: NOW }).stats.added, 1);
});

test("unknown files are left to the CSV importer", async () => {
  assert.equal(I.parseRows((await read("Name,SKU\nBolt,B1\n")).rows), null);
  assert.deepEqual(await I.readBytes(enc("   "), "x.csv"), { error: "bad" });
  assert.deepEqual(await I.readBytes(new Uint8Array(I.MAX_FILE + 1), "x.csv"), { error: "big" });
});

test("plan: stable ids, categories and suppliers by name, one count movement", async () => {
  const res = I.parseRows((await read(SHOPIFY)).rows);
  const d0 = empty();
  d0.cats.push({ id: "cat0000001", m: 5, name: "shirts" });
  const p = I.plan(d0, res, { now: NOW, today: TODAY, setQty: true });
  assert.equal(p.stats.added, 3);
  assert.equal(p.items[0].id, I.idOf("shopify", "s:tee-r-m"));
  assert.ok(p.items.every((x) => C.ID_RE.test(x.id)));
  assert.equal(p.items[0].cat, "cat0000001", "existing category reused (folded)");
  assert.equal(p.cats.length, 1, "Kitchen created");
  assert.equal(p.sups.length, 1);
  assert.equal(p.items[0].price, 1990);
  assert.equal(p.items[0].cost, 750);
  assert.equal(p.moves.length, 1);
  assert.equal(p.moves[0].t, "count");
  assert.equal(p.moves[0].src, "imp:shopify");
  assert.equal(p.stats.qty, 2, "the mug has 0 and needs no line");
  const d1 = I.apply(d0, p);
  const q = C.qtyMap(d1);
  assert.equal(q[p.items[0].id], 5000);
  assert.equal(d1.items.length, 3);
  // the same file again adds nothing
  const p2 = I.plan(d1, res, { now: NOW + 1000, today: TODAY, setQty: true });
  assert.equal(p2.items.length, 0);
  assert.equal(p2.moves.length, 0);
  assert.equal(p2.stats.same, 3);
});

test("plan: the user's own product (same SKU / barcode / name) is never touched", async () => {
  const res = I.parseRows((await read(SQUARE)).rows);
  const d0 = empty();
  d0.items.push(C.normItem({ id: "mine000001", m: 7, name: "My beans", sku: "esp-1", price: 999 }));
  d0.items.push(C.normItem({ id: "mine000002", m: 7, name: "latte cup (small)" }));
  const p = I.plan(d0, res, { now: NOW, setQty: false });
  assert.equal(p.stats.same, 2);
  assert.equal(p.items.length, 1);
  const d1 = I.apply(d0, p);
  assert.equal(d1.items.find((x) => x.id === "mine000001").price, 999);
  assert.equal(d1.moves.length, 0);
});

test("undo: tombstones newer than the rows; counted products archived; sync-safe", async () => {
  const res = I.parseRows((await read(SHOPIFY)).rows);
  const d0 = empty();
  const p = I.plan(d0, res, { now: NOW, today: TODAY, setQty: true });
  const d1 = I.apply(d0, p);
  const d2 = I.undo(d1, p.undo, NOW + 5000);
  // the mug had no movement: gone; the tees keep their (voided) count
  const live = d2.items.filter((x) => !x.arch);
  assert.equal(live.length, 0);
  assert.equal(d2.items.length, 2);
  assert.ok(d2.moves.every((x) => x.v === 1));
  assert.equal(C.stockRows(d2).filter((r) => !r.item.arch).length, 0);
  // another device still holding the import: the merge keeps the undo
  const m = C.merge(d1, d2, NOW + 6000);
  assert.equal(m.items.filter((x) => !x.arch).length, 0);
  assert.ok(m.moves.every((x) => x.v === 1));
  // without quantities, undo leaves no trace but tombstones
  const pq = I.plan(d0, res, { now: NOW, today: TODAY, setQty: false });
  const u = I.undo(I.apply(d0, pq), pq.undo, NOW + 5000);
  assert.equal(u.items.length, 0);
  assert.equal(u.cats.length, 0);
  assert.equal(u.sups.length, 0);
  assert.equal(C.merge(I.apply(d0, pq), u, NOW + 6000).items.length, 0);
  // importing again after an undo brings the products back
  const again = I.plan(u, res, { now: NOW + 9000, setQty: false });
  assert.equal(again.stats.back, 3);
  assert.equal(I.apply(u, again).items.length, 3);
});
