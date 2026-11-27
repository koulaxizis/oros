// AS-SHOP W1 (Chris 2026-11-23): the Assistant finds and changes
// products of the user's own WooCommerce shop (assistant/shop.js).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const S = require("../assistant/shop.js");
const L = require("../links/core.js");
const C = require("../assistant/core.js");
let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const KG = { weight: "kg", dimension: "cm" }, G = { weight: "g", dimension: "mm" };
const book = { id: 41, name: "Ο Γλάρος &amp; ο Λύκος", sku: "978-618-0", type: "simple", status: "publish", weight: "", dimensions: { length: "21", width: "14", height: "" },
               regular_price: "14.90", sale_price: "", manage_stock: true, stock_quantity: 12, stock_status: "instock" };
const vbook = { id: 50, name: "Νύχτες", sku: "", type: "variable", status: "publish", weight: "", dimensions: {}, regular_price: "", sale_price: "", manage_stock: false, stock_quantity: null, stock_status: "instock" };
const variation = { id: 51, sku: "N-EB", attributes: [{ name: "Μορφή", option: "Ψηφιακό" }], weight: "", dimensions: {}, regular_price: "6.00", sale_price: "", manage_stock: "parent", stock_quantity: null, stock_status: "instock" };

test("norm: plain text, numbers as the shop keeps them", () => {
  const r = S.norm(book);
  assert.equal(r.name, "Ο Γλάρος & ο Λύκος");
  assert.equal(r.length, "21");
  assert.equal(r.height, "");
  assert.equal(r.stock_quantity, 12);
  assert.equal(S.norm({ id: 0 }), null);
  assert.equal(S.norm({ id: 3, name: "<b>x</b><script>y</script>" }).name, "x y");
  const v = S.norm(variation, S.norm(vbook));
  assert.equal(v.parent, 50);
  assert.equal(v.attrs, "Μορφή: Ψηφιακό");
  assert.equal(v.manage_stock, "parent");
});

test("find: id, SKU, words without accents, exact name alone", () => {
  const rows = [S.norm(book), S.norm(vbook), S.norm({ id: 42, name: "Ο Γλάρος (ebook)", type: "simple" })];
  assert.deepEqual(S.find(rows, "41").map((r) => r.id), [41]);
  assert.deepEqual(S.find(rows, "978-618-0").map((r) => r.id), [41]);
  assert.deepEqual(S.find(rows, "γλαρος").map((r) => r.id).sort(), [41, 42]);
  assert.deepEqual(S.find(rows, "ΝΥΧΤΕΣ").map((r) => r.id), [50]);
  assert.deepEqual(S.find(rows, "Ο Γλάρος (ebook)").map((r) => r.id), [42]);
  assert.deepEqual(S.find(rows, "τίποτα"), []);
  const vars = [S.norm(variation, S.norm(vbook)), S.norm({ id: 52, attributes: [{ name: "Μορφή", option: "Έντυπο" }] }, S.norm(vbook))];
  assert.deepEqual(S.findVar(vars, "ψηφιακο").map((v) => v.id), [51]);
  assert.deepEqual(S.findVar(vars, "52").map((v) => v.id), [52]);
  assert.deepEqual(S.findVar(vars, "Μορφή").length, 2);
});

test("pickShop: one shop by default, several need a name", () => {
  const one = [{ id: "abcdefgh1", name: "Γλαρόλυκοι", site: "https://www.glarolykoi.net" }];
  assert.equal(S.pickShop(one).id, "abcdefgh1");
  assert.ok(S.pickShop([]).err);
  const two = one.concat([{ id: "abcdefgh2", name: "Other", site: "https://other.example" }]);
  assert.ok(S.pickShop(two).err);
  assert.equal(S.pickShop(two, "glarolykoi.net").id, "abcdefgh1");
  assert.equal(S.pickShop(two, "γλαρολυκοι").id, "abcdefgh1");
  assert.ok(S.pickShop(two, "nobody").err);
});

test("amount: units are converted to the shop's", () => {
  assert.deepEqual(S.amount("350 g", "weight", "kg"), { v: "0.35" });
  assert.deepEqual(S.amount("350γρ", "weight", "kg"), { v: "0.35" });
  assert.deepEqual(S.amount("0,35 κιλά", "weight", "g"), { v: "350" });
  assert.deepEqual(S.amount("1 lbs", "weight", "kg"), { v: "0.454" });
  assert.deepEqual(S.amount(2, "weight", "kg"), { v: "2" });
  assert.deepEqual(S.amount("21 cm", "length", "mm"), { v: "210" });
  assert.deepEqual(S.amount("210 χιλ", "length", "cm"), { v: "21" });
  assert.ok(S.amount("0 g", "weight", "kg").err);
  assert.ok(S.amount("0.1 g", "weight", "kg").err);   // below the shop's 3 decimals
  assert.ok(S.amount("5 stones", "weight", "kg").err);
  assert.ok(S.amount("heavy", "weight", "kg").err);
});

test("normArgs: only the shop fields, one count at a time", () => {
  assert.ok(S.normArgs({ weight: "1 kg" }).err);                      // no product
  assert.ok(S.normArgs({ product: "41" }).err);                       // nothing to change
  assert.match(S.normArgs({ product: "41", name: "x" }).err, /does not change name/);
  assert.ok(S.normArgs({ product: "41", stock_quantity: 3, stock_change: 1 }).err);
  assert.ok(S.normArgs({ product: "41", stock_status: "gone" }).err);
  assert.ok(S.normArgs({ product: "41", sale_price: "3", sale_price_clear: true }).err);
  const ok = S.normArgs({ product: "41", weight: "350 g", stock_change: "-2" });
  assert.equal(ok.ok, true);
  assert.equal(ok.add, -2);
});

test("plan: 350 g on a book without weight, in kg; the body passes both allowlists", () => {
  const p = S.plan(S.norm(book), S.normArgs({ product: "41", weight: "350 g" }), KG);
  assert.equal(p.ok, true);
  assert.deepEqual(p.body, { weight: "0.35" });
  assert.deepEqual(p.rows, [{ f: "pweight", k: "weight", b: "", a: "0.35 kg" }]);
  assert.deepEqual(p.before, { weight: "" });
  const req = S.putReq({ pid: 41, vid: 0 }, p.body);
  assert.equal(L.checkReq("woo", req), "");
  assert.equal(X.checkExtReq("woo", req), "");
});

test("plan: sizes, prices, a sale, stock", () => {
  const cur = S.norm(book);
  let p = S.plan(cur, S.normArgs({ product: "41", length: "21 cm", height: "1.5 cm", sale_price: "11,90", stock_change: 3 }), KG);
  assert.equal(p.ok, true);
  assert.deepEqual(p.body, { dimensions: { height: "1.5" }, sale_price: "11.90", stock_quantity: 15 });   // length was already 21
  assert.equal(L.checkReq("woo", S.putReq({ pid: 41 }, p.body)), "");
  assert.ok(S.plan(cur, S.normArgs({ product: "41", sale_price: "20" }), KG).err);       // not below the price
  assert.ok(S.plan(cur, S.normArgs({ product: "41", stock_change: -13 }), KG).err);     // below 0
  assert.match(S.plan(cur, S.normArgs({ product: "41", length: "210 mm" }), KG).err, /Nothing would change/);
  p = S.plan(cur, S.normArgs({ product: "41", regular_price: "16" }), G);
  assert.deepEqual(p.body, { regular_price: "16.00" });
  // a count on a product that does not count stock turns counting on
  const loose = S.norm(Object.assign({}, book, { manage_stock: false, stock_quantity: null }));
  p = S.plan(loose, S.normArgs({ product: "41", stock_quantity: 4 }), KG);
  assert.deepEqual(p.body, { stock_quantity: 4, manage_stock: true });
  assert.deepEqual(p.before, { manage_stock: false });
  assert.ok(S.plan(loose, S.normArgs({ product: "41", stock_change: 1 }), KG).err);
});

test("plan: a product with variations needs one; a variation's own stock", () => {
  assert.match(S.plan(S.norm(vbook), S.normArgs({ product: "50", weight: "1 g" }), KG).err, /variations/);
  const v = S.norm(variation, S.norm(vbook));
  const p = S.plan(v, S.normArgs({ product: "50", variation: "Ψηφιακό", stock_quantity: 100 }), KG);
  assert.deepEqual(p.body, { stock_quantity: 100, manage_stock: true });
  const req = S.putReq({ pid: 50, vid: 51 }, p.body);
  assert.equal(req.path, "/products/50/variations/51");
  assert.equal(L.checkReq("woo", req), "");
});

test("undo: only while the shop still shows the Assistant's values", () => {
  const cur = S.norm(book);
  const p = S.plan(cur, S.normArgs({ product: "41", weight: "350 g", height: "2 cm", sale_price: "9.90" }), KG);
  const mem = { after: p.after, before: p.before };
  const now = S.norm(Object.assign({}, book, { weight: "0.350", dimensions: { length: "21", width: "14", height: "2" }, sale_price: "9.90" }));
  const u = S.undoPlan(now, mem);
  assert.equal(u.ok, true);
  assert.deepEqual(u.body, { weight: "", dimensions: { height: "" }, sale_price: "" });
  assert.equal(L.checkReq("woo", S.putReq({ pid: 41 }, u.body)), "");
  assert.equal(X.checkExtReq("woo", S.putReq({ pid: 41 }, u.body)), "");
  const moved = S.norm(Object.assign({}, book, { weight: "0.4", dimensions: { height: "2" }, sale_price: "9.90" }));
  assert.deepEqual(S.undoPlan(moved, mem), { ok: false, err: "changed" });
  assert.deepEqual(S.undoPlan(null, mem), { ok: false, err: "gone" });
  // a first price cannot be taken away again
  const free = S.norm(Object.assign({}, book, { regular_price: "" }));
  const q = S.plan(free, S.normArgs({ product: "41", regular_price: "5" }), KG);
  assert.deepEqual(q.keep, ["regular_price"]);
  assert.deepEqual(S.undoPlan(S.norm(Object.assign({}, book, { regular_price: "5" })), { after: q.after, before: q.before }), { ok: false, err: "keep" });
});

test("requests: every read passes both allowlists", () => {
  [S.listReq(1), S.listReq(30), S.productReq(41), S.varsReq(50), S.skuReq("978-618-0")].concat(S.unitReqs()).forEach((r) => {
    assert.equal(L.checkReq("woo", r), "", r.path);
    assert.equal(X.checkExtReq("woo", r), "", r.path);
  });
  assert.equal(S.skuReq("a b"), null);
});

test("tools: shop_find and shop_change only with a shop; the prompt names the card", () => {
  const names = (o) => C.toolsFor(o).map((t) => t.name);
  assert.ok(!names({ data: 1 }).includes("shop_find"));
  assert.ok(names({ data: 1, shop: "read" }).includes("shop_find"));
  assert.ok(!names({ data: 1, shop: "read" }).includes("shop_change"));
  assert.ok(names({ data: 1, shop: "write" }).includes("shop_change"));
  const sp = C.systemPrompt({ lang: "el", now: Date.now(), apps: ["Shop (shop)"], shop: "write", shops: ["Γλαρόλυκοι"] });
  assert.match(sp, /shop_change/);
  assert.match(sp, /Γλαρόλυκοι/);
  const t = C.toolsFor({ data: 1, shop: "write" }).find((x) => x.name === "shop_change");
  assert.match(t.description, /must press Apply/);
  Object.keys(t.params.properties).forEach((k) => assert.ok(["product", "variation", "shop", "sale_price_clear", "stock_change"].concat(S.FIELDS).includes(k), k));
});
