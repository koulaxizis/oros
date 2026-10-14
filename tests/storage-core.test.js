// Pure logic of Storage (storage/core.js): the merge with the wave-2
// fields (old rows keep their bytes), search with paths, move rules
// and the cycle guard, value totals, the Lent out list, reminder
// alerts, money parsing, box links (QR labels) and file names.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "storage/core.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function row(id, type, parentId, extra) {
  return Object.assign({ id, type, name: id.toUpperCase(), bi: null, parentId: parentId || null, pos: 0, mtime: 10, del: false },
    type === "item" ? { qty: 1 } : {}, extra || {});
}
// Home › Kitchen › Cupboard › Top shelf + items; Garage room, Shelf furniture, Box position
function sample() {
  return [
    { id: "seed-sp-home", type: "space", name: "", bi: { en: "Home", el: "Σπίτι" }, parentId: null, pos: 0, mtime: 0, del: false },
    row("kitchen", "room", "seed-sp-home", { name: "Kitchen" }),
    row("garage", "room", "seed-sp-home", { name: "Garage", pos: 1 }),
    row("cupboard", "furniture", "kitchen", { name: "Cupboard" }),
    row("shelf", "furniture", "garage", { name: "Metal shelf" }),
    row("top", "position", "cupboard", { name: "Top shelf" }),
    row("box1", "position", "shelf", { name: "Box 1", note: "Christmas decorations", tags: ["Seasonal"] }),
    row("drill", "item", "box1", { name: "Cordless drill", qty: 1, val: 12999, tags: ["tools", "DIY"], warr: "2026-11-10" }),
    row("pasta", "item", "top", { name: "Pasta maker", qty: 2, val: 2500, note: "hand crank" }),
    row("tent", "item", "box1", { name: "Tent", qty: 1, lent: { to: "Γιώργος", on: "2026-10-01", due: "2026-10-12" } }),
    row("ghost", "item", "gone", { name: "Pasta orphan" }),
    row("old", "furniture", "garage", { name: "Old pasta dresser", del: true })
  ];
}

// ---------- merge ----------
test("merge: old rows keep their exact bytes (no upload after the update)", () => {
  const old = [
    { id: "a1", type: "item", name: "Lamp", bi: null, parentId: "p1", pos: 0, mtime: 5, del: false, qty: 2, note: "" },
    { id: "p1", type: "position", name: "Shelf", bi: null, parentId: "f1", pos: 0, mtime: 5, del: false }
  ];
  const out = C.mergeEnts(old, []);
  assert.equal(JSON.stringify(out[0]), JSON.stringify(old[0]));
  assert.equal(JSON.stringify(out[1]), JSON.stringify(old[1]));
  // merge(get, get) === get
  const d = { ver: 1, ents: C.mergeEnts(sample(), []) };
  assert.equal(JSON.stringify(C.mergeData(d, d)), JSON.stringify(d));
});

test("merge: the new fields survive, cleaned; junk is dropped deterministically", () => {
  const r = C.mergeRow({
    id: "i1", type: "item", name: "TV", parentId: "p", pos: 0, mtime: 7, qty: 1,
    tags: ["#Electronics", "electronics", " living   room ", "", 5], val: 49999.4, bought: "2025-02-30", warr: "2027-01-31",
    ph: ["item1-abcd.jpg", "../evil.jpg", "item1-abcd.jpg"], rc: "item1-zz99.pdf",
    lent: { to: "  Maria  ", on: "2026-10-01", due: "nope" }, extra: "x"
  });
  assert.deepEqual(r.tags, ["Electronics", "living room"]);
  assert.equal(r.val, 49999);
  assert.equal(r.bought, undefined);
  assert.equal(r.warr, "2027-01-31");
  assert.deepEqual(r.ph, ["item1-abcd.jpg"]);
  assert.equal(r.rc, "item1-zz99.pdf");
  assert.deepEqual(r.lent, { to: "Maria", on: "2026-10-01" });
  assert.equal(r.extra, undefined);
  // a level keeps a note and tags but no item fields
  const lv = C.mergeRow({ id: "b", type: "position", mtime: 1, note: "  ", tags: "a, b", val: 5, lent: { to: "x", on: "2026-01-01" } });
  assert.equal(lv.note, undefined);
  assert.deepEqual(lv.tags, ["a", "b"]);
  assert.equal(lv.val, undefined);
  assert.equal(lv.lent, undefined);
  assert.equal(C.mergeRow({ id: "x", type: "item" }), null, "no mtime → dropped");
});

test("merge: per row LWW keeps the newer edit's new fields; same input → same bytes both ways", () => {
  const a = [row("i", "item", "p", { mtime: 20, tags: ["new"], lent: { to: "Nikos", on: "2026-10-02" } })];
  const b = [row("i", "item", "p", { mtime: 10, val: 100 })];
  assert.deepEqual(C.mergeEnts(a, b)[0].tags, ["new"]);
  assert.equal(C.mergeEnts(b, a)[0].lent.to, "Nikos");
  // a copy stripped by an older app version (same mtime) never beats the full row
  const full = [row("i", "item", "p", { mtime: 40, tags: ["kept"], val: 500 })];
  const stripped = [row("i", "item", "p", { mtime: 40 })];
  assert.deepEqual(C.mergeEnts(full, stripped)[0].tags, ["kept"]);
  assert.deepEqual(C.mergeEnts(stripped, full)[0].tags, ["kept"]);
  const x = [row("i", "item", "p", { mtime: 30, val: 1 })], y = [row("i", "item", "p", { mtime: 30, val: 2 })];
  assert.equal(JSON.stringify(C.mergeEnts(x, y)), JSON.stringify(C.mergeEnts(y, x)));
});

// ---------- search ----------
test("search: names, notes, tags and lent-to across levels, with the path", () => {
  const ents = sample();
  const hits = C.search(ents, "pasta", "en");
  assert.deepEqual(hits.map((h) => h.id), ["pasta"], "orphans and tombstones are skipped");
  assert.deepEqual(hits[0].path, ["Home", "Kitchen", "Cupboard", "Top shelf"]);
  assert.equal(C.search(ents, "diy", "en")[0].id, "drill");
  assert.equal(C.search(ents, "diy", "en")[0].field, "tags");
  assert.equal(C.search(ents, "christmas", "en")[0].id, "box1");
  assert.equal(C.search(ents, "christmas", "en")[0].field, "note");
  assert.equal(C.search(ents, "γιωργος", "en")[0].id, "tent", "accent-free Greek");
  assert.equal(C.search(ents, "seasonal box", "en")[0].id, "box1", "every word must match");
  assert.deepEqual(C.search(ents, "", "en"), []);
  assert.equal(C.search(ents, "σπιτι", "el")[0].id, "seed-sp-home");
  // ranking: name prefix first
  const r = C.search(ents.concat([row("z", "item", "top", { name: "Shelf liner" })]), "shelf", "en").map((h) => h.id);
  assert.ok(r.indexOf("z") < r.indexOf("top"), r.join());
});

// ---------- move ----------
test("move: fixed levels, never into itself or below, never onto dead rows", () => {
  const ents = sample();
  assert.equal(C.moveError(ents, "drill", "top"), null);
  assert.equal(C.moveError(ents, "drill", "box1"), "same");
  assert.equal(C.moveError(ents, "drill", "cupboard"), "level");
  assert.equal(C.moveError(ents, "box1", "cupboard"), null);
  assert.equal(C.moveError(ents, "seed-sp-home", "kitchen"), "root");
  assert.equal(C.moveError(ents, "drill", "old"), "target");
  assert.equal(C.moveError(ents, "ghost", "top"), "gone");
  assert.deepEqual(C.moveTargets(ents, "drill"), ["top"]);
  assert.deepEqual(C.moveTargets(ents, "box1"), ["cupboard"]);
  assert.deepEqual(C.moveTargets(ents, "cupboard"), ["garage"]);
  // a corrupted tree where a row would land inside itself
  const loop = [
    row("s", "space", null), row("r", "room", "s"), row("f", "furniture", "r"),
    row("p", "position", "f"), row("f2", "furniture", "p")         // bad parent level
  ];
  assert.equal(C.moveError(loop, "f", "f"), "level");
  const self = [row("s", "space", null), row("r1", "room", "s"), row("x", "room", "x")];
  assert.equal(C.moveError(self, "r1", "x"), "target", "a self-parented row is not alive");
});

test("move: cycle guard on a row that would contain its own target", () => {
  // two spaces where one "space" is (wrongly) inside a room: moving the
  // room into that space would close a loop
  const ents = [row("s", "space", null), row("r", "room", "s"), row("s2", "space", "r")];
  assert.equal(C.isAlive(ents, "s2"), false);
  assert.equal(C.moveError(ents, "r", "s2"), "target");
  const ok = [row("s", "space", null), row("s2", "space", null), row("r", "room", "s")];
  assert.equal(C.moveError(ok, "r", "s2"), null);
});

// ---------- totals + lent ----------
test("totals: value × quantity per place, everything at the top", () => {
  const T = C.totals(sample());
  assert.equal(T[""].v, 12999 + 2 * 2500);
  assert.equal(T[""].n, 3);
  assert.equal(T.kitchen.v, 5000);
  assert.equal(T.garage.v, 12999);
  assert.equal(T.box1.n, 2);
  assert.equal(T.old, undefined);
});

test("lent: live lent items, due first, with path", () => {
  const ents = sample().concat([
    row("bike", "item", "top", { name: "Bike", lent: { to: "Eleni", on: "2026-09-01" } }),
    row("book", "item", "top", { name: "Book", lent: { to: "Kostas", on: "2026-10-05", due: "2026-10-20" } })
  ]);
  const L = C.lentList(ents, "en");
  assert.deepEqual(L.map((x) => x.id), ["tent", "book", "bike"]);
  assert.deepEqual(L[0].path, ["Home", "Garage", "Metal shelf", "Box 1"]);
  assert.equal(L[0].to, "Γιώργος");
});

// ---------- reminders ----------
test("alerts: warranty 30 → 7 → 0 steps, return-by from the day, each step once", () => {
  const ents = sample();
  let a = C.alerts(ents, "2026-10-14");
  assert.deepEqual(a.map((x) => [x.kind, x.id, x.step, x.days]), [["w", "drill", 30, 27], ["l", "tent", 0, -2]]);
  assert.deepEqual(C.alerts(ents, "2026-09-01").map((x) => x.id), [], "too early, nothing due");
  assert.equal(C.alerts(ents, "2026-11-04").find((x) => x.kind === "w").step, 7);
  assert.equal(C.alerts(ents, "2026-11-10").find((x) => x.kind === "w").step, 0);
  assert.equal(C.alerts(ents, "2026-11-17").find((x) => x.kind === "w").step, 0);
  assert.equal(C.alerts(ents, "2026-11-18").find((x) => x.kind === "w"), undefined, "a week after: dropped");
  // toNotify: announced at 30 → silent until the 7-day step
  const notified = {};
  a.forEach((x) => { notified[x.key] = x.step; });
  assert.deepEqual(C.toNotify(C.alerts(ents, "2026-10-20"), notified), []);
  assert.equal(C.toNotify(C.alerts(ents, "2026-11-04"), notified).length, 1);
  // a new warranty date is a new key
  const moved = ents.map((e) => e.id === "drill" ? Object.assign({}, e, { warr: "2026-11-12" }) : e);
  assert.equal(C.toNotify(C.alerts(moved, "2026-10-20"), notified).length, 1);
  assert.equal(C.alertLine(a[0], ents, "en"), "Cordless drill: warranty ends in 27 days");
  assert.equal(C.alertLine(a[1], ents, "el"), "Tent: επιστροφή από Γιώργος (καθυστερεί)");
});

test("prefs: reminders off by default, currency EUR", () => {
  assert.deepEqual(C.readPrefs(null), { remind: -1, cur: "EUR" });
  assert.deepEqual(C.readPrefs({ remind: 9, cur: "GBP" }), { remind: 9, cur: "GBP" });
  assert.deepEqual(C.readPrefs({ remind: 24, cur: "XXX" }), { remind: -1, cur: "EUR" });
});

// ---------- money ----------
test("parseMoney: dots, commas, thousands", () => {
  assert.equal(C.parseMoney(""), 0);
  assert.equal(C.parseMoney("25"), 2500);
  assert.equal(C.parseMoney("25,5"), 2550);
  assert.equal(C.parseMoney("25.50"), 2550);
  assert.equal(C.parseMoney("1.234,56"), 123456);
  assert.equal(C.parseMoney("1,234.56"), 123456);
  assert.equal(C.parseMoney("1.234"), 123400);
  assert.equal(C.parseMoney("€ 12"), 1200);
  assert.equal(C.parseMoney("12,"), null);
  assert.equal(C.parseMoney("abc"), null);
  assert.equal(C.parseMoney("-5"), null);
});

// ---------- links + files ----------
test("box links: QR content round-trips; foreign or broken codes are refused", () => {
  const link = C.boxLink("https://useoros.online/storage/index.html?standalone#x", "mfz8k2abc123");
  assert.equal(link, "https://useoros.online/storage/?box=mfz8k2abc123");
  assert.equal(C.parseBox(link), "mfz8k2abc123");
  assert.equal(C.parseBox("https://my.host/oros/storage/?box=seed-sp-home"), "seed-sp-home");
  assert.equal(C.parseBox("?standalone&box=abc"), "abc");
  assert.equal(C.parseBox("?box=abc"), "abc");
  assert.equal(C.parseBox("https://evil.example/notes/?box=abc"), null);
  assert.equal(C.parseBox("?box=a%20b"), null);
  assert.equal(C.parseBox("EAN 5201234567890"), null);
  assert.equal(C.boxLink("https://x/storage/", "bad id"), null);
});

test("file names: per item, safe, on the orOS disk", () => {
  assert.equal(C.photoName("mfz8K2abc", "x1y2z3"), "mfz8k2abc-x1y2z3.jpg");
  assert.equal(C.photoPath("mfz8k2abc-x1y2z3.jpg"), "/internal/Storage/Photos/mfz8k2abc-x1y2z3.jpg");
  assert.equal(C.receiptName("mfz8k2abc", "abcd", "pdf"), "mfz8k2abc-abcd.pdf");
  assert.equal(C.receiptPath("mfz8k2abc-abcd.pdf"), "/internal/Storage/Receipts/mfz8k2abc-abcd.pdf");
  assert.equal(C.photoPath("../../x.jpg"), null);
  assert.equal(C.photoName("ab", "abcd"), null);
  const used = C.filesInUse([row("i", "item", "p", { ph: ["iiii-aaaa.jpg"], rc: "iiii-bbbb.pdf" }),
    row("j", "item", "p", { ph: ["jjjj-aaaa.jpg"], del: true })]);
  assert.deepEqual(Object.keys(used.ph), ["iiii-aaaa.jpg"]);
  assert.deepEqual(Object.keys(used.rc), ["iiii-bbbb.pdf"]);
});

test("tags: cleaned, unique ignoring case and accents, at most 10", () => {
  assert.deepEqual(C.cleanTags("#Χειμώνας, χειμωνας; camping\ncamping"), ["Χειμώνας", "camping"]);
  assert.equal(C.cleanTags(Array.from({ length: 20 }, (_, i) => "t" + i)).length, 10);
  assert.equal(C.cleanTags(["x".repeat(50)])[0].length, 30);
});

// ---------- wiring ----------
test("wiring: core before the app, shell engine, deep links, palette, unchanged QR encoder use", () => {
  const html = read("storage/index.html"), js = read("storage/storage.js"), shell = read("shell.js");
  const iq = html.indexOf("../qr/qr-encode.js"), ic = html.indexOf('src="core.js'), ia = html.indexOf('src="storage.js');
  assert.ok(iq > 0 && iq < ia && ic > 0 && ic < ia);
  assert.ok(js.includes("inheritPalette") && js.includes("watchPalette"));
  assert.ok(/registerSlice\("storage", sliceGet, sliceSet, DATA_KEY, mergeData\)/.test(js));
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.ok(js.includes('__orosTakeTarget("storage")'));
  assert.ok(read("index.html").includes('src="storage/core.js'));
  assert.ok(shell.includes('tickSafe("storageCheckTick", storageCheckTickThrottled)'));
  assert.ok(/storage:\s+function \(target\)/.test(read("notifications.js")));
  assert.ok(!/localStorage\.setItem\(["']oros-storage-prefs/.test(read("storage/core.js")), "core writes nothing");
});

test("menu search provider: notes of levels, tags and lent-to in the text", () => {
  const P = require(path.join(__dirname, "..", "storage/search.js"));
  const data = { ver: 1, ents: sample() };
  const hits = P.search({ lang: "en", readJSON: () => data });
  const by = Object.fromEntries(hits.map((h) => [h.id, h]));
  assert.equal(by.box1.text, "Home › Garage › Metal shelf · Christmas decorations · #Seasonal");
  assert.equal(by.drill.text, "Home › Garage › Metal shelf › Box 1 · #tools #DIY");
  assert.equal(by.tent.text, "Home › Garage › Metal shelf › Box 1 · Lent to Γιώργος");
  assert.equal(by.pasta.text, "Home › Kitchen › Cupboard › Top shelf · hand crank");
  assert.equal(by.ghost, undefined);
});
