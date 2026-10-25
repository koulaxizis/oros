// Supplier price lists in Stock (publisher wave P10): the header found
// in EN or EL, ISBN-10 folded into ISBN-13, prices and discounts, the
// comparison with the products here, apply + undo, and what may go to
// the shop.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "stock/core.js"));
const PR = require(path.join(__dirname, "..", "stock/prices.js"));

const NOW = Date.now();
function stock() {
  return C.merge({
    items: [
      { id: "item01", m: 1, name: "Sea Wolves", sku: "978-618-5321-00-0", price: 1600, cost: 1000, min: 2000, rq: 5000, vat: 6 },
      { id: "item02", m: 1, name: "Salt", sku: "S-1", bc: "9789601234567", price: 1200, cost: 700, min: 1000, vat: 6 },
      { id: "item03", m: 1, name: "The Map", sku: "", price: 900, cost: 500, vat: 6, sup: "supp01", ssku: "MAP" },
      { id: "item04", m: 1, name: "Old Thing", sku: "OLD", price: 500, arch: 1 }
    ],
    sups: [{ id: "supp01", m: 1, name: "Big Publisher" }],
    moves: [{ id: "move01", m: 1, t: "in", d: "2026-01-01", lines: [{ i: "item01", q: 3000, c: 1000 }] }],
    settings: { m: 1, cur: "EUR", vat: 6 }
  }, {}, NOW);
}

test("isbn13: ISBN-10 (with X) becomes ISBN-13, other codes stay", () => {
  assert.match(PR.isbn13("960-12-3456-X"), /^978960123456\d$/);
  assert.equal(PR.isbn13("0-306-40615-2"), "9780306406157");
  assert.equal(PR.codeKey(" 978-0-306-40615-7 "), "9780306406157");
  assert.equal(PR.codeKey("map"), "MAP");
  assert.equal(PR.cents("€ 16,00"), 1600);
  assert.equal(PR.cents(12.5), 1250);
  assert.equal(PR.cents("free"), null);
});

test("parse: Greek header after a title row, discount gives the net price, out of print, duplicates", () => {
  const rows = [
    ["Τιμοκατάλογος 2026"],
    ["ISBN", "Τίτλος", "Τιμή λιανικής", "Έκπτωση %", "Διαθεσιμότητα"],
    ["978-618-5321-00-0", "Sea Wolves", "17,50", "40", "Διαθέσιμο"],
    ["9789601234567", "Salt", "12,00", "", "Εξαντλημένο"],
    ["978-618-5321-00-0", "Sea Wolves again", "18", "40", ""],
    ["", "", "", "", ""],
    ["", "No price", "", "", ""],
    ["9780306406157", "New Book", "10", "35%", ""]
  ];
  const r = PR.parse(rows);
  assert.deepEqual(r.lines.map((l) => [l.code, l.price, l.cost, l.out]), [
    ["9786185321000", 1750, 1050, false],
    ["9789601234567", 1200, null, true],
    ["9780306406157", 1000, 650, false]
  ]);
  assert.equal(r.dup, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(PR.parse([["Foo", "Bar"], ["1", "2"]]), { error: "cols" });
  // a CSV that opens with a title line, ";" separated
  const txt = "Price list 2026\nISBN;Title;Price\n9789601234567;Salt;12,00\n";
  assert.deepEqual(PR.parse(PR.rowsOfText(txt)).lines.map((l) => [l.code, l.price]), [["9789601234567", 1200]]);
  // English, net price column, number cells from Excel
  const e = PR.parse([["EAN", "Title", "RRP", "Net price"], [9789601234567, "Salt", 12, 7.2]]);
  assert.deepEqual(e.lines[0], { code: "9789601234567", name: "Salt", price: 1200, cost: 720, out: false });
});

test("compare: new prices, out of print with a minimum, new titles, matches by code / supplier code / name", () => {
  const lines = PR.parse([
    ["ISBN", "Title", "Price", "Discount", "Status"],
    ["9786185321000", "Sea Wolves", "17.50", "40", ""],
    ["9789601234567", "Salt", "12.00", "", "out of print"],
    ["MAP", "The Map", "9.00", "", ""],
    ["", "Old Thing", "6", "", ""],
    ["9780306406157", "New Book", "10", "", ""],
    ["9780306406157X", "", "", "", "out of print"]
  ]).lines;
  const c = PR.compare(stock(), lines, "supp01");
  assert.deepEqual(c.price.map((r) => [r.item.id, r.old, r.now, r.cost]), [["item01", 1600, 1750, 1050]]);
  assert.deepEqual(c.out.map((r) => r.item.id), ["item02"]);
  assert.deepEqual(c.fresh.map((l) => l.name), ["New Book", "Old Thing"]);   // archived: no name match
  assert.equal(c.same, 1);                                                  // The Map
  assert.deepEqual(c.link.map((r) => r.item.id).sort(), ["item01", "item02"]);
});

test("apply + undo: picked changes only, supplier linked, new product priced, undo restores", () => {
  const d0 = stock();
  const lines = PR.parse([["ISBN", "Title", "Price", "Discount", "Status"],
    ["9786185321000", "Sea Wolves", "17.50", "40", ""], ["9789601234567", "Salt", "12", "", "εξαντλημένο"],
    ["9780306406157", "New Book", "10", "30", ""]]).lines;
  const c = PR.compare(d0, lines, "supp01");
  let n = 0;
  const r = PR.apply(d0, c, { price: { item01: true }, out: {}, fresh: { "9780306406157": true } },
    { supId: "supp01", link: true, now: NOW + 10, newId: () => "newit" + (++n) });
  const it = (d, id) => d.items.find((x) => x.id === id);
  assert.equal(it(r.data, "item01").price, 1750);
  assert.equal(it(r.data, "item01").cost, 1050);
  assert.equal(it(r.data, "item01").sup, "supp01");
  assert.equal(it(r.data, "item01").ssku, "9786185321000");
  assert.equal(it(r.data, "item02").min, 1000);                 // not picked
  assert.equal(it(r.data, "item02").sup, "supp01");               // but linked
  const nb = it(r.data, "newit1");
  assert.deepEqual([nb.name, nb.sku, nb.bc, nb.price, nb.cost, nb.sup, nb.vat], ["New Book", "9780306406157", "9780306406157", 1000, 700, "supp01", 6]);
  assert.equal(it(d0, "item01").price, 1600);                    // the input is not touched
  const back = PR.undo(r.data, r.undo, NOW + 20);
  assert.equal(it(back, "item01").price, 1600);
  assert.equal(it(back, "item01").sup, "");
  assert.equal(it(back, "item02").sup, "");
  assert.equal(it(back, "newit1"), undefined);
  assert.ok(back.tombs.newit1 >= NOW);
  // merging with a device that still has the applied copy keeps the undo
  assert.equal(it(C.merge(back, r.data, NOW + 30), "item01").price, 1600);
  assert.equal(it(C.merge(back, r.data, NOW + 30), "newit1"), undefined);
  // out of print, picked: no more reordering
  const r2 = PR.apply(d0, c, { out: { item02: true } }, { supId: "supp01", now: NOW + 10, newId: () => "xxxxxx" });
  assert.equal(it(r2.data, "item02").min, 0);
  assert.equal(it(r2.data, "item02").sup, "");                  // link off
});

test("shopJobs: only picked, SKU-safe codes; prices that changed and new titles", () => {
  const lines = PR.parse([["ISBN", "Title", "Price"], ["9786185321000", "Sea Wolves", "17.50"], ["9780306406157", "New Book", "10"], ["", "No Code", "5"]]).lines;
  const c = PR.compare(stock(), lines, "");
  const jobs = PR.shopJobs(c, { price: { item01: true }, fresh: { "9780306406157": true, "No Code": true } });
  assert.deepEqual(jobs, [
    { k: "price", code: "9786185321000", name: "Sea Wolves", price: 1750 },
    { k: "new", code: "9780306406157", name: "New Book", price: 1000 }
  ]);
});

test("Stock loads the price list and the shop may set a price", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "stock/index.html"), "utf8");
  assert.match(html, /<script src="prices\.js/);
  assert.match(html, /<script src="pricelist\.js/);
  for (const f of ["links/core.js", "relay/ext.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.match(src, /PRODUCT_PUT = \{ stock_quantity: "int", manage_stock: "bool", regular_price: "money" \}/, f);
  }
  // a product on sale at or above the new price is left alone (Woo would show an odd "sale")
  const pl = fs.readFileSync(path.join(__dirname, "..", "stock/pricelist.js"), "utf8");
  assert.match(pl, /sale !== null && sale > 0 && sale >= j\.price\) \{ n\.sp\+\+/);
});
