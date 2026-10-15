// Storage "Import from another app" (storage/import.js): Homebox CSV
// (nested "/" locations, labels, purchase and warranty, sold items
// skipped), Sortly CSV (folder paths "A > B", variants, units, value)
// and any CSV with guessed columns; places mapped onto the fixed
// Space › Room › Furniture › Position hierarchy (reused by name, never
// doubled), stable ids, the user's items kept, and Undo (tombstones
// that win in the sync merge).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "storage/import.js"));
const C = require(path.join(ROOT, "storage/core.js"));

const NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
const seed = () => ({ ver: 1, ents: [{ id: "seed-sp-home", type: "space", name: "", bi: { en: "Home", el: "Σπίτι" }, parentId: null, pos: 0, mtime: 0, del: false }] });
const live = (db) => db.ents.filter((e) => !e.del);
const pathOf = (db, id) => {
  const I2 = C.index(live(db));
  return (C.pathNames(I2, id, "en") || []).join(" › ");
};

const HOMEBOX =
  "HB.import_ref,HB.location,HB.labels,HB.quantity,HB.name,HB.description,HB.insured,HB.serial_number,HB.model_number,HB.manufacturer,HB.notes,HB.purchase_from,HB.purchase_price,HB.purchase_time,HB.lifetime_warranty,HB.warranty_expires,HB.warranty_details,HB.sold_time,HB.sold_price,HB.sold_to,HB.sold_notes\n" +
  "A1,Garage/Shelf 1/Box 3/Bag,Tools; Power,1,Drill,Cordless 18V,true,SN123,DCD777,DeWalt,Spare battery inside,Hardware Shop,129.90,2024-03-02,false,2026-03-02,,,,,\n" +
  "A2,Garage,Tools,4,Screwdriver set,,false,,,,,,,,false,0001-01-01,,,,,\n" +
  "A3,Kitchen/Pantry,,2,Old blender,,false,,,,,,,,,,,2025-01-10,20,Nick,\n" +
  "A4,,,1,Umbrella,<b>red</b>,false,,,,,,,,true,,,,,,\n";

const SORTLY =
  "Entry Name,Variant Details,Sortly ID (SID),Unit,Min Level,Price,Value,Quantity,Notes,Tags,Barcode/QR1-Data,Folder path\n" +
  "Light bulbs,E27 warm,SL001,pcs,4,2.50,25,10,,\"Lighting, Spare\",123456789,Home > Basement > Rack > Top shelf\n" +
  "Paint,,SL002,L,,,30,2.5,White matt,,,Home > Basement\n" +
  "Paint,,SL002,L,,,30,2.5,dup,,,Home > Basement\n";

test("Homebox: nested locations from the top, deeper parts joined, sold skipped", () => {
  const res = I.parseText(HOMEBOX);
  assert.equal(res.source, "homebox");
  assert.equal(res.sold, 1);
  assert.equal(res.items.length, 3);
  const d = res.items[0];
  assert.deepEqual(d.path, ["Garage", "Shelf 1", "Box 3", "Bag"]);
  assert.deepEqual(d.tags, ["Tools", "Power"]);
  assert.equal(d.val, 12990);
  assert.equal(d.bought, "2024-03-02");
  assert.equal(d.warr, "2026-03-02");
  assert.match(d.note, /^Cordless 18V\nSpare battery inside\nMake: DeWalt DCD777\nSerial no\.: SN123\nBought from: Hardware Shop\nInsured$/);
  assert.ok(d.note.length <= C.NOTE_MAX);
  assert.equal(res.items[1].warr, "", "the zero date is no date");
  assert.equal(res.items[1].qty, 4);
  assert.match(res.items[2].note, /Lifetime warranty/);
  // the user's language for the note lines
  assert.match(I.parseText(HOMEBOX, { serial: "Σειριακός" }).items[0].note, /Σειριακός: SN123/);
});

test("Homebox plan with no space named Garage: under Home, from the room down", () => {
  const res = I.parseText(HOMEBOX);
  const db0 = seed();
  assert.equal(I.defaultUnder(db0, res), "seed-sp-home");
  const p = I.plan(db0, res, { now: NOW, under: "seed-sp-home" });
  assert.equal(p.stats.items, 3);
  const db1 = I.apply(db0, p);
  const drill = live(db1).find((e) => e.name === "Drill");
  assert.equal(pathOf(db1, drill.id), "Home › Garage › Shelf 1 › Box 3 / Bag");
  const pos = live(db1).find((e) => e.id === drill.parentId);
  assert.equal(pos.type, "position");
  const sd = live(db1).find((e) => e.name === "Screwdriver set");
  assert.equal(pathOf(db1, sd.id), "Home › Garage › General › General");
  // the Garage room is one place, not two
  assert.equal(live(db1).filter((e) => e.name === "Garage").length, 1);
  const um = live(db1).find((e) => e.name === "Umbrella");
  assert.equal(pathOf(db1, um.id), "Home › General › General › General");
  assert.ok(db1.ents.every((e) => C.mergeRow(e)));
  // the same file twice adds nothing
  const p2 = I.plan(db1, res, { now: NOW + 1, under: "seed-sp-home" });
  assert.equal(p2.rows.length, 0);
  assert.equal(p2.stats.same, 3);
});

test("Sortly: folder path, the first part an existing space, variants, units, value", () => {
  const res = I.parseText(SORTLY);
  assert.equal(res.source, "sortly");
  assert.equal(res.skipped, 1, "the repeated SID");
  const [b, p] = res.items;
  assert.equal(b.name, "Light bulbs (E27 warm)");
  assert.equal(b.qty, 10);
  assert.equal(b.val, 250);
  assert.deepEqual(b.tags, ["Lighting", "Spare"]);
  assert.match(b.note, /Min level: 4/);
  assert.match(b.note, /Barcode: 123456789/);
  assert.equal(p.qty, 3);
  assert.match(p.note, /^White matt\nQuantity: 2\.5 L$/);
  assert.equal(p.val, 1000, "value ÷ quantity");
  const db0 = seed();
  assert.equal(I.defaultUnder(db0, res), "", "Home is already a space (its bilingual seed)");
  const db1 = I.apply(db0, I.plan(db0, res, { now: NOW, under: "" }));
  const bulbs = live(db1).find((e) => e.name === "Light bulbs (E27 warm)");
  assert.equal(pathOf(db1, bulbs.id), "Home › Basement › Rack › Top shelf");
  assert.equal(live(db1).filter((e) => e.type === "space").length, 1);
});

test("generic CSV: guessed columns, Greek headers, separate room / box columns", () => {
  const res = I.parseText("Αντικείμενο;Τοποθεσία;Ποσότητα;Σημειώσεις\nΣκηνή;Αποθήκη > Ράφι;1;4 ατόμων\nΥπνόσακος;Αποθήκη > Ράφι;2;\n");
  assert.equal(res.source, "generic");
  assert.deepEqual(res.cols, { name: "Αντικείμενο", loc: "Τοποθεσία", qty: "Ποσότητα", note: "Σημειώσεις" });
  assert.deepEqual(res.items[0].path, ["Αποθήκη", "Ράφι"]);
  assert.equal(res.items[1].qty, 2);
  const r2 = I.parseText("Thing,Room,Box,Qty\nCables,Office,Blue box,3\n");
  assert.equal(r2.cols.name, "Thing");
  assert.deepEqual(r2.items[0].path, ["Office", "Blue box"]);
  // no name header: the first free column
  assert.equal(I.parseText("Stuff,Where\nTent,Loft\n").cols.name, "Stuff");
  assert.equal(I.parseText(""), null);
  assert.equal(I.parseText("name\n"), null);
});

test("the user's item with the same name in the same place is kept", () => {
  const db0 = seed();
  const res = I.parseText("name,location\nTent,Home > Loft > Shelf > Top\n");
  const db1 = I.apply(db0, I.plan(db0, res, { now: NOW, under: "" }));
  const tent = live(db1).find((e) => e.name === "Tent");
  // the user deletes the import's tent and adds their own there
  tent.del = true; tent.mtime = NOW + 5;
  db1.ents.push({ id: "mine1", type: "item", name: "tent", parentId: tent.parentId, pos: 1, mtime: NOW + 6, del: false, qty: 1 });
  const p = I.plan(db1, res, { now: NOW + 10, under: "" });
  assert.equal(p.rows.length, 0);
  assert.equal(p.stats.same, 1);
});

test("undo: tombstones newer than the rows; a deleted import comes back on a new import", () => {
  const res = I.parseText(HOMEBOX);
  const db0 = seed();
  const p = I.plan(db0, res, { now: NOW, under: "seed-sp-home" });
  const db1 = I.apply(db0, p);
  const db2 = I.undo(db1, p.undo, NOW + 1000);
  assert.deepEqual(live(db2).map((e) => e.id), ["seed-sp-home"]);
  // another device still holding the import: the tombstones win
  const m = C.mergeData(db1, db2);
  assert.deepEqual(m.ents.filter((e) => !e.del).map((e) => e.id), ["seed-sp-home"]);
  assert.deepEqual(C.mergeData(db2, db1), m);
  // import again: everything returns, newer than its tombstone
  const p3 = I.plan(db2, res, { now: NOW + 2000, under: "seed-sp-home" });
  assert.equal(p3.stats.items, 3);
  assert.equal(p3.stats.back, p3.rows.length);
  const db3 = I.apply(db2, p3);
  assert.equal(C.mergeData(db3, m).ents.filter((e) => !e.del).length, live(db3).length);
});
